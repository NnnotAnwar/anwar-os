package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"slices"
	"strings"
	"time"

	"github.com/nnnotanwar/anwarnnnot/services/ops-agent/internal/docker"
)

type DeployResult struct {
	OK          bool             `json:"ok"`
	Service     *Service         `json:"service,omitempty"`
	Tag         string           `json:"tag"`
	PreviousTag string           `json:"previous_tag"`
	RolledBack  bool             `json:"rolled_back"`
	Error       string           `json:"error,omitempty"`
	Logs        []docker.LogLine `json:"logs,omitempty"`
	Seconds     float64          `json:"seconds"`
}

// Deploy replaces container c with the same container on another tag of its
// image, the way `docker compose up -d <service>` would:
//
//  1. pull repo:tag (nothing changes if that fails)
//  2. park the old container under <name>-ops-previous and stop it (a Telegram
//     token can only be polled by one process)
//  3. create the new container with the old one's config, host config, labels
//     and networks/aliases (defaults inherited from the old image are dropped
//     so the new image's own CMD/ENV/HEALTHCHECK apply), start it
//  4. wait until it is healthy (or, without a healthcheck, still running after
//     Settle); then remove the old container
//
// On any failure after step 2 the new container is removed and the old one is
// renamed back and started. The compose labels stay on the new container, so
// `docker compose ps` keeps listing it under the same service.
func (a *Agent) Deploy(ctx context.Context, c *docker.Inspect, tag string) (*DeployResult, error) {
	start := time.Now()
	repo, prevTag := SplitImage(c.ImageRef())
	res := &DeployResult{Tag: tag, PreviousTag: prevTag}
	done := func() *DeployResult {
		res.Seconds = time.Since(start).Round(100 * time.Millisecond).Seconds()
		return res
	}
	ref := repo + ":" + tag

	pullCtx, cancelPull := context.WithTimeout(ctx, 5*time.Minute)
	err := a.engine.Pull(pullCtx, repo, tag)
	cancelPull()
	if err != nil {
		res.Error = err.Error()
		return done(), nil // nothing was touched
	}
	oldImg, err := a.engine.InspectImage(ctx, c.Image)
	if err != nil {
		return nil, fmt.Errorf("inspect current image: %w", err)
	}
	newImg, err := a.engine.InspectImage(ctx, ref)
	if err != nil {
		return nil, fmt.Errorf("inspect %s: %w", ref, err)
	}

	name := c.ContainerName()
	parked := name + retiredSuffix
	wasRunning := c.State.Running
	if err := a.engine.Rename(ctx, c.ID, parked); err != nil {
		return nil, fmt.Errorf("park old container: %w", err)
	}
	if wasRunning {
		if err := a.engine.Stop(ctx, c.ID, c.StopTimeout(15)); err != nil {
			_ = a.engine.Rename(context.WithoutCancel(ctx), c.ID, name)
			return nil, fmt.Errorf("stop old container: %w", err)
		}
	}

	newID, err := a.createLike(ctx, name, c, oldImg, newImg, ref)
	if err == nil {
		err = a.engine.Start(ctx, newID)
	}
	if err == nil {
		err = a.waitHealthy(ctx, newID)
	}
	if err != nil {
		res.Error = err.Error()
		// The deploy context may be what ran out; rolling back gets its own.
		rbCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Minute)
		defer cancel()
		if newID != "" {
			tailCtx, cancelTail := context.WithTimeout(rbCtx, 5*time.Second)
			res.Logs, _ = a.engine.Logs(tailCtx, newID, 60, false)
			cancelTail()
			_ = a.engine.Remove(rbCtx, newID)
		}
		if rbErr := a.restore(rbCtx, c.ID, name, wasRunning); rbErr != nil {
			res.Error += "; rollback failed: " + rbErr.Error()
		} else {
			res.RolledBack = true
		}
		return done(), nil
	}

	if err := a.engine.Remove(ctx, c.ID); err != nil {
		a.log.Warn("old container left behind", "container", parked, "err", err.Error())
	}
	fresh, err := a.engine.Inspect(ctx, newID)
	if err == nil {
		svc := toService(fresh)
		res.Service = &svc
	}
	res.OK = true
	return done(), nil
}

func (a *Agent) restore(ctx context.Context, oldID, name string, start bool) error {
	if err := a.engine.Rename(ctx, oldID, name); err != nil {
		return err
	}
	if start {
		return a.engine.Start(ctx, oldID)
	}
	return nil
}

func (a *Agent) createLike(ctx context.Context, name string, old *docker.Inspect, oldImg, newImg *docker.Image, ref string) (string, error) {
	body, extra := RecreateBody(old, oldImg, newImg, ref)
	id, err := a.engine.Create(ctx, name, body)
	if err != nil {
		return "", fmt.Errorf("create: %w", err)
	}
	for _, n := range extra {
		if err := a.engine.Connect(ctx, n.network, id, n.endpoint); err != nil {
			return id, fmt.Errorf("connect %s: %w", n.network, err)
		}
	}
	return id, nil
}

type extraNetwork struct {
	network  string
	endpoint map[string]any
}

// RecreateBody builds the create request for a copy of old running ref. It
// returns the networks to connect after create (only the primary network can
// be given at create time on every API version).
func RecreateBody(old *docker.Inspect, oldImg, newImg *docker.Image, ref string) (map[string]any, []extraNetwork) {
	body := clone(old.Config)
	body["Image"] = ref
	delete(body, "MacAddress") // moved to the endpoint config in API 1.44

	// Drop what the container only had because the old image said so.
	img := oldImg.Config
	if env, ok := body["Env"].([]any); ok {
		imgEnv, _ := img["Env"].([]any)
		kept := []any{}
		for _, e := range env {
			if !slices.ContainsFunc(imgEnv, func(x any) bool { return x == e }) {
				kept = append(kept, e)
			}
		}
		body["Env"] = kept
	}
	for _, key := range []string{"Cmd", "Entrypoint", "WorkingDir", "User", "Healthcheck", "ExposedPorts", "Volumes", "StopSignal", "Shell", "OnBuild"} {
		if v, ok := body[key]; ok && reflect.DeepEqual(v, img[key]) {
			delete(body, key)
		}
	}
	if labels, ok := body["Labels"].(map[string]any); ok {
		imgLabels, _ := img["Labels"].(map[string]any)
		for k, v := range labels {
			if iv, ok := imgLabels[k]; ok && iv == v {
				delete(labels, k)
			}
		}
		if _, ok := labels[labelComposeImage]; ok {
			labels[labelComposeImage] = newImg.ID
		}
	}
	// Docker sets the hostname to the short container ID unless told otherwise.
	if h, _ := body["Hostname"].(string); len(old.ID) >= 12 && h == old.ID[:12] {
		delete(body, "Hostname")
	}

	host := clone(old.HostConfig)
	body["HostConfig"] = host

	mode, _ := host["NetworkMode"].(string)
	names := make([]string, 0, len(old.NetworkSettings.Networks))
	for n := range old.NetworkSettings.Networks {
		names = append(names, n)
	}
	slices.Sort(names)
	var extra []extraNetwork
	if mode == "host" || mode == "none" || strings.HasPrefix(mode, "container:") {
		return body, nil
	}
	primary := mode
	if _, ok := old.NetworkSettings.Networks[primary]; !ok && len(names) > 0 {
		primary = names[0]
	}
	for _, n := range names {
		ep := endpointFor(old.NetworkSettings.Networks[n], old.ID)
		if n == primary {
			body["NetworkingConfig"] = map[string]any{"EndpointsConfig": map[string]any{n: ep}}
		} else {
			extra = append(extra, extraNetwork{network: n, endpoint: ep})
		}
	}
	return body, extra
}

// endpointFor keeps what defines the endpoint (aliases, static IPs, links) and
// drops what Docker assigns (IDs, addresses, the old container's own alias).
func endpointFor(old map[string]any, oldID string) map[string]any {
	ep := map[string]any{}
	for _, k := range []string{"IPAMConfig", "Links", "DriverOpts"} {
		if v, ok := old[k]; ok && v != nil {
			ep[k] = v
		}
	}
	if aliases, ok := old["Aliases"].([]any); ok {
		kept := []any{}
		for _, a := range aliases {
			s, _ := a.(string)
			if s == "" || strings.HasPrefix(oldID, s) {
				continue
			}
			kept = append(kept, s)
		}
		ep["Aliases"] = kept
	}
	return ep
}

func clone(m map[string]any) map[string]any {
	raw, _ := json.Marshal(m)
	var out map[string]any
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.UseNumber()
	_ = dec.Decode(&out)
	if out == nil {
		out = map[string]any{}
	}
	return out
}

// waitHealthy polls the new container until its healthcheck passes, it dies,
// or DeployTimeout runs out.
func (a *Agent) waitHealthy(ctx context.Context, id string) error {
	deadline := time.Now().Add(a.cfg.DeployTimeout)
	var runningSince time.Time
	for {
		c, err := a.engine.Inspect(ctx, id)
		if err != nil {
			return err
		}
		st := c.State
		switch {
		case st.Status == "exited" || st.Status == "dead":
			return fmt.Errorf("new container exited with code %d", st.ExitCode)
		case st.Restarting || c.RestartCount > 0:
			return fmt.Errorf("new container is crash-looping")
		case st.Health != nil:
			switch st.Health.Status {
			case "healthy":
				return nil
			case "unhealthy":
				msg := "new container is unhealthy"
				if n := len(st.Health.Log); n > 0 {
					msg += ": " + strings.TrimSpace(st.Health.Log[n-1].Output)
				}
				return fmt.Errorf("%s", msg)
			}
		case st.Running:
			if runningSince.IsZero() {
				runningSince = time.Now()
			} else if time.Since(runningSince) >= a.cfg.Settle {
				return nil
			}
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("new container not healthy after %s", a.cfg.DeployTimeout)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Second):
		}
	}
}
