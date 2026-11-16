// Package docker is a minimal Docker Engine API client over the unix socket.
// Standard library only: this process holds root-equivalent access to the host,
// so it carries no third-party code.
package docker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// APIError is a non-2xx answer from the Engine API.
type APIError struct {
	Status  int
	Message string
}

func (e *APIError) Error() string { return fmt.Sprintf("docker: %d %s", e.Status, e.Message) }

// IsNotFound reports whether err is a 404 from the Engine API.
func IsNotFound(err error) bool {
	var api *APIError
	return errors.As(err, &api) && api.Status == http.StatusNotFound
}

type Client struct {
	http *http.Client
	// RegistryAuth, if set, is sent as X-Registry-Auth on pulls from RegistryHost.
	RegistryHost string
	RegistryAuth string
}

// New talks to the daemon at the unix socket path. Unversioned API paths: the
// daemon answers with its own current API version.
func New(socket string) *Client {
	tr := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			var d net.Dialer
			return d.DialContext(ctx, "unix", socket)
		},
		MaxIdleConns:    4,
		IdleConnTimeout: 30 * time.Second,
	}
	return &Client{http: &http.Client{Transport: tr}}
}

// SetRegistryCredentials makes pulls from host authenticate with user/token.
func (c *Client) SetRegistryCredentials(host, user, token string) {
	raw, _ := json.Marshal(map[string]string{"username": user, "password": token, "serveraddress": host})
	c.RegistryHost = host
	c.RegistryAuth = encodeAuth(raw)
}

func (c *Client) do(ctx context.Context, method, path string, q url.Values, body any, hdr http.Header) (*http.Response, error) {
	var rd io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		rd = bytes.NewReader(raw)
	}
	u := "http://docker" + path
	if len(q) > 0 {
		u += "?" + q.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, method, u, rd)
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range hdr {
		req.Header[k] = v
	}
	res, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	if res.StatusCode >= 300 && res.StatusCode != http.StatusNotModified {
		defer res.Body.Close()
		raw, _ := io.ReadAll(io.LimitReader(res.Body, 64<<10))
		var m struct {
			Message string `json:"message"`
		}
		_ = json.Unmarshal(raw, &m)
		if m.Message == "" {
			m.Message = strings.TrimSpace(string(raw))
		}
		return nil, &APIError{Status: res.StatusCode, Message: m.Message}
	}
	return res, nil
}

func (c *Client) call(ctx context.Context, method, path string, q url.Values, in, out any) error {
	res, err := c.do(ctx, method, path, q, in, nil)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if out == nil {
		_, _ = io.Copy(io.Discard, res.Body)
		return nil
	}
	dec := json.NewDecoder(res.Body)
	dec.UseNumber() // keep int64 fields (memory limits, nano CPUs) exact on re-encode
	return dec.Decode(out)
}

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

type Summary struct {
	ID     string            `json:"Id"`
	Names  []string          `json:"Names"`
	Image  string            `json:"Image"`
	Labels map[string]string `json:"Labels"`
	State  string            `json:"State"`
	Status string            `json:"Status"`
}

// List returns all containers (running or not) that carry label=value.
func (c *Client) List(ctx context.Context, label, value string) ([]Summary, error) {
	filters, _ := json.Marshal(map[string][]string{"label": {label + "=" + value}})
	var out []Summary
	err := c.call(ctx, http.MethodGet, "/containers/json", url.Values{"all": {"1"}, "filters": {string(filters)}}, nil, &out)
	return out, err
}

type Health struct {
	Status        string `json:"Status"`
	FailingStreak int    `json:"FailingStreak"`
	Log           []struct {
		ExitCode int    `json:"ExitCode"`
		Output   string `json:"Output"`
	} `json:"Log"`
}

type State struct {
	Status     string  `json:"Status"`
	Running    bool    `json:"Running"`
	Restarting bool    `json:"Restarting"`
	ExitCode   int     `json:"ExitCode"`
	Error      string  `json:"Error"`
	StartedAt  string  `json:"StartedAt"`
	FinishedAt string  `json:"FinishedAt"`
	Health     *Health `json:"Health"`
}

// Inspect keeps Config, HostConfig and the network endpoints as generic maps so
// a recreated container gets every field back, including ones this client
// doesn't know about.
type Inspect struct {
	ID              string         `json:"Id"`
	Name            string         `json:"Name"`
	Image           string         `json:"Image"` // image ID
	Created         string         `json:"Created"`
	RestartCount    int            `json:"RestartCount"`
	State           State          `json:"State"`
	Config          map[string]any `json:"Config"`
	HostConfig      map[string]any `json:"HostConfig"`
	NetworkSettings struct {
		Networks map[string]map[string]any `json:"Networks"`
	} `json:"NetworkSettings"`
}

// ContainerName without the leading slash.
func (i *Inspect) ContainerName() string { return strings.TrimPrefix(i.Name, "/") }

// ImageRef is the image the container was created from, as written (repo:tag).
func (i *Inspect) ImageRef() string { s, _ := i.Config["Image"].(string); return s }

func (i *Inspect) Labels() map[string]string { return stringMap(i.Config["Labels"]) }

func (i *Inspect) Tty() bool { b, _ := i.Config["Tty"].(bool); return b }

// StopTimeout in seconds, from the container config (compose stop_grace_period).
func (i *Inspect) StopTimeout(def int) int {
	if n, ok := i.Config["StopTimeout"].(json.Number); ok {
		if v, err := n.Int64(); err == nil && v > 0 {
			return int(v)
		}
	}
	return def
}

func stringMap(v any) map[string]string {
	out := map[string]string{}
	if m, ok := v.(map[string]any); ok {
		for k, val := range m {
			if s, ok := val.(string); ok {
				out[k] = s
			}
		}
	}
	return out
}

func (c *Client) Inspect(ctx context.Context, id string) (*Inspect, error) {
	var out Inspect
	if err := c.call(ctx, http.MethodGet, "/containers/"+url.PathEscape(id)+"/json", nil, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) Start(ctx context.Context, id string) error {
	return c.call(ctx, http.MethodPost, "/containers/"+url.PathEscape(id)+"/start", nil, nil, nil)
}

func (c *Client) Stop(ctx context.Context, id string, timeoutSec int) error {
	q := url.Values{"t": {strconv.Itoa(timeoutSec)}}
	return c.call(ctx, http.MethodPost, "/containers/"+url.PathEscape(id)+"/stop", q, nil, nil)
}

func (c *Client) Restart(ctx context.Context, id string, timeoutSec int) error {
	q := url.Values{"t": {strconv.Itoa(timeoutSec)}}
	return c.call(ctx, http.MethodPost, "/containers/"+url.PathEscape(id)+"/restart", q, nil, nil)
}

func (c *Client) Rename(ctx context.Context, id, name string) error {
	return c.call(ctx, http.MethodPost, "/containers/"+url.PathEscape(id)+"/rename", url.Values{"name": {name}}, nil, nil)
}

func (c *Client) Remove(ctx context.Context, id string) error {
	q := url.Values{"force": {"1"}, "v": {"0"}}
	return c.call(ctx, http.MethodDelete, "/containers/"+url.PathEscape(id), q, nil, nil)
}

// Create makes a container from a full create body (Config fields + HostConfig
// + NetworkingConfig) and returns its ID.
func (c *Client) Create(ctx context.Context, name string, body map[string]any) (string, error) {
	var out struct {
		ID string `json:"Id"`
	}
	err := c.call(ctx, http.MethodPost, "/containers/create", url.Values{"name": {name}}, body, &out)
	return out.ID, err
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

type Image struct {
	ID     string         `json:"Id"`
	Config map[string]any `json:"Config"`
}

func (c *Client) InspectImage(ctx context.Context, ref string) (*Image, error) {
	var out Image
	// Image refs contain '/' and ':'; the API takes them unescaped in the path.
	if err := c.call(ctx, http.MethodGet, "/images/"+ref+"/json", nil, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Pull fetches repo:tag. The API streams JSON progress messages and reports
// failures (unknown tag, denied) inside that stream with status 200.
func (c *Client) Pull(ctx context.Context, repo, tag string) error {
	var hdr http.Header
	if c.RegistryAuth != "" && registryHost(repo) == c.RegistryHost {
		hdr = http.Header{"X-Registry-Auth": {c.RegistryAuth}}
	}
	res, err := c.do(ctx, http.MethodPost, "/images/create", url.Values{"fromImage": {repo}, "tag": {tag}}, nil, hdr)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	dec := json.NewDecoder(res.Body)
	for {
		var msg struct {
			Error       string `json:"error"`
			ErrorDetail struct {
				Message string `json:"message"`
			} `json:"errorDetail"`
		}
		if err := dec.Decode(&msg); err == io.EOF {
			return nil
		} else if err != nil {
			return fmt.Errorf("pull %s:%s: %w", repo, tag, err)
		}
		if msg.Error != "" {
			return fmt.Errorf("pull %s:%s: %s", repo, tag, msg.Error)
		}
	}
}

func registryHost(repo string) string {
	first, _, found := strings.Cut(repo, "/")
	if found && (strings.ContainsAny(first, ".:") || first == "localhost") {
		return first
	}
	return "docker.io"
}

// ---------------------------------------------------------------------------
// Networks
// ---------------------------------------------------------------------------

func (c *Client) Connect(ctx context.Context, network, container string, endpoint map[string]any) error {
	body := map[string]any{"Container": container, "EndpointConfig": endpoint}
	return c.call(ctx, http.MethodPost, "/networks/"+url.PathEscape(network)+"/connect", nil, body, nil)
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

type Stats struct {
	CPUPercent    float64
	MemBytes      uint64
	MemLimitBytes uint64
}

type rawStats struct {
	CPU struct {
		Usage struct {
			Total uint64 `json:"total_usage"`
		} `json:"cpu_usage"`
		System uint64 `json:"system_cpu_usage"`
		Online uint64 `json:"online_cpus"`
	} `json:"cpu_stats"`
	PreCPU struct {
		Usage struct {
			Total uint64 `json:"total_usage"`
		} `json:"cpu_usage"`
		System uint64 `json:"system_cpu_usage"`
	} `json:"precpu_stats"`
	Memory struct {
		Usage uint64            `json:"usage"`
		Limit uint64            `json:"limit"`
		Stats map[string]uint64 `json:"stats"`
	} `json:"memory_stats"`
}

// Stats samples CPU and memory once. Without one-shot the daemon waits for a
// second sample (~1 s) so the CPU delta is meaningful.
func (c *Client) Stats(ctx context.Context, id string) (*Stats, error) {
	var raw rawStats
	if err := c.call(ctx, http.MethodGet, "/containers/"+url.PathEscape(id)+"/stats", url.Values{"stream": {"false"}}, nil, &raw); err != nil {
		return nil, err
	}
	return computeStats(raw), nil
}

func computeStats(raw rawStats) *Stats {
	s := &Stats{MemLimitBytes: raw.Memory.Limit}
	if raw.CPU.Usage.Total >= raw.PreCPU.Usage.Total && raw.CPU.System > raw.PreCPU.System {
		cpu := float64(raw.CPU.Usage.Total - raw.PreCPU.Usage.Total)
		sys := float64(raw.CPU.System - raw.PreCPU.System)
		online := float64(raw.CPU.Online)
		if online == 0 {
			online = 1
		}
		s.CPUPercent = cpu / sys * online * 100
	}
	// Same as `docker stats`: page cache that can be reclaimed doesn't count.
	cache := raw.Memory.Stats["inactive_file"]                // cgroup v2
	if v, ok := raw.Memory.Stats["total_inactive_file"]; ok { // cgroup v1
		cache = v
	}
	if raw.Memory.Usage > cache {
		s.MemBytes = raw.Memory.Usage - cache
	} else {
		s.MemBytes = raw.Memory.Usage
	}
	return s
}
