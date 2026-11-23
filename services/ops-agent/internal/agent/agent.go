// Package agent is the HTTP API web uses to see and control managed containers.
//
// Rules, enforced here and nowhere else:
//   - only containers labelled os.managed=true (and, if configured, in one of
//     the compose projects) exist for the API; anything else is a 404
//   - os.protected=true containers can be listed, read, started and restarted,
//     but never stopped or deployed
//   - deploys only change the tag of the image the container already runs
//   - every request except /healthz carries a valid HMAC signature (package sign)
package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/nnnotanwar/anwar-os/services/ops-agent/internal/docker"
	"github.com/nnnotanwar/anwar-os/services/ops-agent/internal/sign"
)

const (
	LabelManaged   = "os.managed"
	LabelProtected = "os.protected"
	LabelRole      = "os.role"
	LabelKind      = "os.kind"
	LabelName      = "os.name"

	labelComposeService = "com.docker.compose.service"
	labelComposeProject = "com.docker.compose.project"
	labelComposeOneoff  = "com.docker.compose.oneoff"
	labelComposeImage   = "com.docker.compose.image"
	labelRevision       = "org.opencontainers.image.revision"

	// The old container is parked under this suffix while its replacement starts.
	retiredSuffix = "-ops-previous"

	maxBody = 64 << 10
)

// Engine is the part of the Docker API the agent uses (a fake in unit tests).
type Engine interface {
	List(ctx context.Context, label, value string) ([]docker.Summary, error)
	Inspect(ctx context.Context, id string) (*docker.Inspect, error)
	Stats(ctx context.Context, id string) (*docker.Stats, error)
	Logs(ctx context.Context, id string, tail int, tty bool) ([]docker.LogLine, error)
	Start(ctx context.Context, id string) error
	Stop(ctx context.Context, id string, timeoutSec int) error
	Restart(ctx context.Context, id string, timeoutSec int) error
	Rename(ctx context.Context, id, name string) error
	Remove(ctx context.Context, id string) error
	Create(ctx context.Context, name string, body map[string]any) (string, error)
	Connect(ctx context.Context, network, container string, endpoint map[string]any) error
	InspectImage(ctx context.Context, ref string) (*docker.Image, error)
	Pull(ctx context.Context, repo, tag string) error
}

type Config struct {
	// Projects limits the agent to these compose projects
	// (com.docker.compose.project). Empty = any project. Production sets it, so a
	// stray `docker run` of a bot image (whose image carries os.managed=true) is
	// invisible. The first one is the primary project: its services keep their
	// plain names ("web"); services of the others are qualified
	// ("shiftella.web"), so two projects can both have a "web".
	Projects []string
	// DeployTimeout bounds the wait for a new container to become healthy.
	DeployTimeout time.Duration
	// Settle is how long a container without a healthcheck must stay running.
	Settle  time.Duration
	Version string
}

type Agent struct {
	engine   Engine
	verifier *sign.Verifier
	cfg      Config
	log      *slog.Logger

	mu   sync.Mutex
	busy map[string]bool // service name -> a mutating call is running
}

func New(engine Engine, verifier *sign.Verifier, cfg Config, log *slog.Logger) *Agent {
	if cfg.DeployTimeout == 0 {
		cfg.DeployTimeout = 240 * time.Second
	}
	if cfg.Settle == 0 {
		cfg.Settle = 10 * time.Second
	}
	return &Agent{engine: engine, verifier: verifier, cfg: cfg, log: log, busy: map[string]bool{}}
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

var (
	errNotFound  = errors.New("no managed service with that name")
	errProtected = errors.New("this service is protected: it can't be stopped or deployed from the panel")
	errAmbiguous = errors.New("more than one container claims that service name")
	errBusy      = errors.New("another action on this service is still running")
	errBadTag    = errors.New("tag must be 1-128 characters: letters, digits, '_', '.', '-'")
	errBadAction = errors.New("unknown action")
)

var tagRe = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$`)

// Actions the API offers, and whether a protected service allows them.
var actions = map[string]bool{"start": true, "restart": true, "stop": false, "deploy": false}

// CheckAction applies the label rules to one action on a container.
func CheckAction(labels map[string]string, action string) error {
	allowedWhenProtected, known := actions[action]
	if !known {
		return errBadAction
	}
	if labels[LabelManaged] != "true" {
		return errNotFound
	}
	if labels[LabelProtected] == "true" && !allowedWhenProtected {
		return errProtected
	}
	return nil
}

// visible decides whether a listed container belongs to the API at all.
func (a *Agent) visible(labels map[string]string, containerName string) bool {
	if labels[LabelManaged] != "true" {
		return false
	}
	if len(a.cfg.Projects) > 0 && !contains(a.cfg.Projects, labels[labelComposeProject]) {
		return false
	}
	if strings.EqualFold(labels[labelComposeOneoff], "true") { // `compose run` jobs
		return false
	}
	return !strings.HasSuffix(containerName, retiredSuffix)
}

// ServiceName is the compose service name, or the container name outside compose.
func ServiceName(labels map[string]string, containerName string) string {
	if s := labels[labelComposeService]; s != "" {
		return s
	}
	return strings.TrimPrefix(containerName, "/")
}

// QualifiedName is the name the API uses for a service: the plain service name
// in the primary project, "<project>.<service>" in any other project.
func QualifiedName(labels map[string]string, containerName, primary string) string {
	svc := ServiceName(labels, containerName)
	if project := labels[labelComposeProject]; project != "" && primary != "" && project != primary {
		return project + "." + svc
	}
	return svc
}

func (a *Agent) primary() string {
	if len(a.cfg.Projects) == 0 {
		return ""
	}
	return a.cfg.Projects[0]
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func firstName(names []string) string {
	if len(names) == 0 {
		return ""
	}
	return strings.TrimPrefix(names[0], "/")
}

// SplitImage turns "ghcr.io/o/app:abc@sha256:…" into ("ghcr.io/o/app", "abc").
func SplitImage(ref string) (repo, tag string) {
	if i := strings.Index(ref, "@"); i >= 0 {
		ref = ref[:i]
	}
	slash, colon := strings.LastIndex(ref, "/"), strings.LastIndex(ref, ":")
	if colon > slash {
		return ref[:colon], ref[colon+1:]
	}
	return ref, "latest"
}

func (a *Agent) managed(ctx context.Context) ([]docker.Summary, error) {
	all, err := a.engine.List(ctx, LabelManaged, "true")
	if err != nil {
		return nil, err
	}
	out := all[:0]
	for _, c := range all {
		if a.visible(c.Labels, firstName(c.Names)) {
			out = append(out, c)
		}
	}
	return out, nil
}

// resolve finds the one visible container for a service name.
func (a *Agent) resolve(ctx context.Context, name string) (*docker.Inspect, error) {
	list, err := a.managed(ctx)
	if err != nil {
		return nil, err
	}
	var match []docker.Summary
	for _, c := range list {
		if QualifiedName(c.Labels, firstName(c.Names), a.primary()) == name || firstName(c.Names) == name {
			match = append(match, c)
		}
	}
	switch len(match) {
	case 0:
		return nil, errNotFound
	case 1:
	default:
		return nil, errAmbiguous
	}
	c, err := a.engine.Inspect(ctx, match[0].ID)
	if err != nil {
		return nil, err
	}
	// Labels re-checked on the inspected state, not only the list filter.
	if !a.visible(c.Labels(), c.ContainerName()) {
		return nil, errNotFound
	}
	return c, nil
}

func (a *Agent) lock(name string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.busy[name] {
		return false
	}
	a.busy[name] = true
	return true
}

func (a *Agent) unlock(name string) {
	a.mu.Lock()
	delete(a.busy, name)
	a.mu.Unlock()
}

// ---------------------------------------------------------------------------
// Service view
// ---------------------------------------------------------------------------

type Service struct {
	Name          string   `json:"name"`
	Container     string   `json:"container"`
	Image         string   `json:"image"`
	Tag           string   `json:"tag"`
	Revision      string   `json:"revision,omitempty"`
	State         string   `json:"state"`  // running | exited | restarting | paused | created | dead
	Health        string   `json:"health"` // healthy | unhealthy | starting | none
	StartedAt     string   `json:"started_at,omitempty"`
	FinishedAt    string   `json:"finished_at,omitempty"`
	ExitCode      int      `json:"exit_code"`
	OOMKilled     bool     `json:"oom_killed"`
	RestartCount  int      `json:"restart_count"`
	Protected     bool     `json:"protected"`
	Role          string   `json:"role,omitempty"`
	Kind          string   `json:"kind,omitempty"`
	BotName       string   `json:"bot_name,omitempty"`
	CPUPercent    *float64 `json:"cpu_percent"`
	MemBytes      *uint64  `json:"mem_bytes"`
	MemLimitBytes *uint64  `json:"mem_limit_bytes"`
}

func zeroTime(s string) string {
	if strings.HasPrefix(s, "0001-") {
		return ""
	}
	return s
}

func toService(c *docker.Inspect, primary string) Service {
	labels := c.Labels()
	repo, tag := SplitImage(c.ImageRef())
	health := "none"
	if c.State.Health != nil && c.State.Health.Status != "" {
		health = c.State.Health.Status
	}
	return Service{
		Name:         QualifiedName(labels, c.ContainerName(), primary),
		Container:    c.ContainerName(),
		Image:        repo,
		Tag:          tag,
		Revision:     labels[labelRevision],
		State:        c.State.Status,
		Health:       health,
		StartedAt:    zeroTime(c.State.StartedAt),
		FinishedAt:   zeroTime(c.State.FinishedAt),
		ExitCode:     c.State.ExitCode,
		OOMKilled:    c.State.OOMKilled,
		RestartCount: c.RestartCount,
		Protected:    labels[LabelProtected] == "true",
		Role:         labels[LabelRole],
		Kind:         labels[LabelKind],
		BotName:      labels[LabelName],
	}
}

func (a *Agent) withStats(ctx context.Context, svcs []Service, ids []string) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	sem := make(chan struct{}, 6)
	var wg sync.WaitGroup
	for i := range svcs {
		if svcs[i].State != "running" {
			continue
		}
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			st, err := a.engine.Stats(ctx, ids[i])
			if err != nil {
				return
			}
			cpu := float64(int(st.CPUPercent*10+0.5)) / 10
			mem, limit := st.MemBytes, st.MemLimitBytes
			svcs[i].CPUPercent, svcs[i].MemBytes, svcs[i].MemLimitBytes = &cpu, &mem, &limit
		}(i)
	}
	wg.Wait()
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

type apiError struct {
	Error   string `json:"error"`
	Message string `json:"message"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// classify maps an error to an HTTP status and a stable error code.
func classify(err error) (int, apiError) {
	status, code := http.StatusBadGateway, "docker_error"
	switch {
	case errors.Is(err, errNotFound):
		status, code = http.StatusNotFound, "not_found"
	case errors.Is(err, errProtected):
		status, code = http.StatusForbidden, "protected"
	case errors.Is(err, errAmbiguous), errors.Is(err, errBusy):
		status, code = http.StatusConflict, "conflict"
	case errors.Is(err, errBadTag), errors.Is(err, errBadAction):
		status, code = http.StatusBadRequest, "bad_request"
	}
	return status, apiError{Error: code, Message: err.Error()}
}

func (a *Agent) fail(w http.ResponseWriter, err error) {
	status, body := classify(err)
	writeJSON(w, status, body)
}

type ctxKey struct{}

// Handler is the whole API, signature check included.
func (a *Agent) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /services", a.listServices)
	mux.HandleFunc("GET /services/{name}", a.getService)
	mux.HandleFunc("GET /services/{name}/logs", a.logs)
	mux.HandleFunc("POST /services/{name}/deploy", a.deploy)
	mux.HandleFunc("POST /services/{name}/{action}", a.lifecycle)

	signed := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(io.LimitReader(r.Body, maxBody+1))
		if err != nil || len(body) > maxBody {
			writeJSON(w, http.StatusRequestEntityTooLarge, apiError{"too_large", "request body too large"})
			return
		}
		if err := a.verifier.Verify(r, body); err != nil {
			a.log.Warn("refused unsigned request", "method", r.Method, "path", r.URL.Path, "reason", err.Error())
			writeJSON(w, http.StatusUnauthorized, apiError{"unauthorized", "invalid or missing signature"})
			return
		}
		r = r.WithContext(context.WithValue(r.Context(), ctxKey{}, body))
		mux.ServeHTTP(w, r)
	})

	root := http.NewServeMux()
	root.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	root.Handle("/", signed)
	return a.accessLog(root)
}

func (a *Agent) accessLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: 200}
		next.ServeHTTP(rec, r)
		if r.URL.Path == "/healthz" {
			return
		}
		a.log.Info("request", "method", r.Method, "path", r.URL.Path, "status", rec.status,
			"ms", time.Since(start).Milliseconds())
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

func bodyOf(r *http.Request) []byte { b, _ := r.Context().Value(ctxKey{}).([]byte); return b }

func (a *Agent) listServices(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	list, err := a.managed(ctx)
	if err != nil {
		a.fail(w, err)
		return
	}
	svcs := make([]Service, 0, len(list))
	ids := make([]string, 0, len(list))
	for _, c := range list {
		in, err := a.engine.Inspect(ctx, c.ID)
		if err != nil {
			if docker.IsNotFound(err) { // removed between list and inspect
				continue
			}
			a.fail(w, err)
			return
		}
		svcs = append(svcs, toService(in, a.primary()))
		ids = append(ids, in.ID)
	}
	if r.URL.Query().Get("stats") != "0" {
		a.withStats(ctx, svcs, ids)
	}
	sort.SliceStable(svcs, func(i, j int) bool { return svcs[i].Name < svcs[j].Name })
	writeJSON(w, http.StatusOK, map[string]any{
		"services": svcs,
		"agent":    map[string]any{"version": a.cfg.Version, "time": time.Now().UTC().Format(time.RFC3339)},
	})
}

func (a *Agent) getService(w http.ResponseWriter, r *http.Request) {
	c, err := a.resolve(r.Context(), r.PathValue("name"))
	if err != nil {
		a.fail(w, err)
		return
	}
	svc := []Service{toService(c, a.primary())}
	a.withStats(r.Context(), svc, []string{c.ID})
	writeJSON(w, http.StatusOK, svc[0])
}

func (a *Agent) logs(w http.ResponseWriter, r *http.Request) {
	tail := 200
	if v := r.URL.Query().Get("tail"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			a.fail(w, fmt.Errorf("%w: tail must be a positive number", errBadAction))
			return
		}
		tail = min(n, 1000)
	}
	c, err := a.resolve(r.Context(), r.PathValue("name"))
	if err != nil {
		a.fail(w, err)
		return
	}
	lines, err := a.engine.Logs(r.Context(), c.ID, tail, c.Tty())
	if err != nil {
		a.fail(w, err)
		return
	}
	if lines == nil {
		lines = []docker.LogLine{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"service": r.PathValue("name"), "lines": lines})
}

// mutation runs fn for one service under the rules and the per-service lock.
// It detaches from the request context: a client that disconnects mid-way must
// not leave a container half-stopped or a deploy half-rolled-back.
func (a *Agent) mutation(r *http.Request, action string, timeout time.Duration,
	fn func(ctx context.Context, c *docker.Inspect) (any, error),
) (int, any) {
	name := r.PathValue("name")
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), timeout)
	defer cancel()

	c, err := a.resolve(ctx, name)
	if err != nil {
		return errorResponse(err)
	}
	if err := CheckAction(c.Labels(), action); err != nil {
		a.log.Warn("refused", "service", name, "action", action, "reason", err.Error())
		return errorResponse(err)
	}
	svc := QualifiedName(c.Labels(), c.ContainerName(), a.primary())
	if !a.lock(svc) {
		return errorResponse(errBusy)
	}
	defer a.unlock(svc)

	a.log.Info("action", "service", svc, "action", action)
	out, err := fn(ctx, c)
	if err != nil {
		a.log.Error("action failed", "service", svc, "action", action, "err", err.Error())
		return errorResponse(err)
	}
	return http.StatusOK, out
}

func errorResponse(err error) (int, any) { return classify(err) }

func (a *Agent) lifecycle(w http.ResponseWriter, r *http.Request) {
	action := r.PathValue("action")
	if _, ok := actions[action]; !ok || action == "deploy" {
		a.fail(w, errBadAction)
		return
	}
	status, out := a.mutation(r, action, 90*time.Second, func(ctx context.Context, c *docker.Inspect) (any, error) {
		grace := c.StopTimeout(15)
		var err error
		switch action {
		case "start":
			err = a.engine.Start(ctx, c.ID)
		case "stop":
			err = a.engine.Stop(ctx, c.ID, grace)
		case "restart":
			err = a.engine.Restart(ctx, c.ID, grace)
		}
		if err != nil {
			return nil, err
		}
		fresh, err := a.engine.Inspect(ctx, c.ID)
		if err != nil {
			return nil, err
		}
		return map[string]any{"ok": true, "service": toService(fresh, a.primary())}, nil
	})
	writeJSON(w, status, out)
}

func (a *Agent) deploy(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Tag string `json:"tag"`
	}
	if err := json.Unmarshal(bodyOf(r), &in); err != nil || !tagRe.MatchString(in.Tag) {
		a.fail(w, errBadTag)
		return
	}
	status, out := a.mutation(r, "deploy", a.cfg.DeployTimeout+5*time.Minute, func(ctx context.Context, c *docker.Inspect) (any, error) {
		res, err := a.Deploy(ctx, c, in.Tag)
		if err != nil {
			return nil, err
		}
		return res, nil
	})
	if res, ok := out.(*DeployResult); ok && !res.OK {
		status = http.StatusBadGateway
	}
	writeJSON(w, status, out)
}
