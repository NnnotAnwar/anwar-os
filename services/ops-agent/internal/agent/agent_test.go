package agent

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/nnnotanwar/anwar-os/services/ops-agent/internal/docker"
	"github.com/nnnotanwar/anwar-os/services/ops-agent/internal/sign"
)

var secret = []byte("unit-test-secret-0123456789abcdef0123")

// ---------------------------------------------------------------------------
// Fake engine: containers in memory, every mutating call recorded.
// ---------------------------------------------------------------------------

type fakeContainer struct {
	inspect docker.Inspect
}

type fakeEngine struct {
	mu         sync.Mutex
	containers map[string]*fakeContainer
	images     map[string]*docker.Image
	calls      []string
	nextID     int
	// newHealth is the health status containers created by Create report.
	newHealth string
	pullErr   error
}

func newFake() *fakeEngine {
	return &fakeEngine{containers: map[string]*fakeContainer{}, images: map[string]*docker.Image{}, newHealth: "healthy"}
}

func (f *fakeEngine) add(id, name string, labels map[string]string, image string, running bool) {
	l := map[string]any{}
	for k, v := range labels {
		l[k] = v
	}
	status := "exited"
	if running {
		status = "running"
	}
	f.containers[id] = &fakeContainer{inspect: docker.Inspect{
		ID: id + strings.Repeat("0", 64-len(id)), Name: "/" + name, Image: "sha256:" + image,
		State:      docker.State{Status: status, Running: running, Health: &docker.Health{Status: "healthy"}},
		Config:     map[string]any{"Image": image, "Labels": l, "Env": []any{"A=1"}},
		HostConfig: map[string]any{"NetworkMode": "proj_internal"},
	}}
	f.containers[id].inspect.NetworkSettings.Networks = map[string]map[string]any{
		"proj_internal": {"Aliases": []any{name}},
	}
	f.images["sha256:"+image] = &docker.Image{ID: "sha256:" + image, Config: map[string]any{"Env": []any{}}}
}

func (f *fakeEngine) record(s string) { f.calls = append(f.calls, s) }

func (f *fakeEngine) find(id string) (*fakeContainer, error) {
	for k, c := range f.containers {
		if k == id || c.inspect.ID == id {
			return c, nil
		}
	}
	return nil, &docker.APIError{Status: 404, Message: "no such container"}
}

func (f *fakeEngine) List(_ context.Context, label, value string) ([]docker.Summary, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []docker.Summary
	// Deliberately unfiltered: the agent must not trust the daemon's filter alone.
	for _, c := range f.containers {
		out = append(out, docker.Summary{ID: c.inspect.ID, Names: []string{c.inspect.Name}, Labels: c.inspect.Labels(), State: c.inspect.State.Status})
	}
	slices.SortFunc(out, func(a, b docker.Summary) int { return strings.Compare(a.Names[0], b.Names[0]) })
	return out, nil
}

func (f *fakeEngine) Inspect(_ context.Context, id string) (*docker.Inspect, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	c, err := f.find(id)
	if err != nil {
		return nil, err
	}
	cp := c.inspect
	return &cp, nil
}

func (f *fakeEngine) Stats(context.Context, string) (*docker.Stats, error) {
	return &docker.Stats{CPUPercent: 1.234, MemBytes: 1 << 20, MemLimitBytes: 1 << 27}, nil
}

func (f *fakeEngine) Logs(context.Context, string, int, bool) ([]docker.LogLine, error) {
	return []docker.LogLine{{TS: "2026-11-16T10:00:00Z", Stream: "stdout", Text: "hello"}}, nil
}

func (f *fakeEngine) setState(id string, running bool) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	c, err := f.find(id)
	if err != nil {
		return err
	}
	c.inspect.State.Running = running
	c.inspect.State.Status = map[bool]string{true: "running", false: "exited"}[running]
	return nil
}

func (f *fakeEngine) Start(_ context.Context, id string) error {
	f.record("start " + id[:4])
	return f.setState(id, true)
}

func (f *fakeEngine) Stop(_ context.Context, id string, _ int) error {
	f.record("stop " + id[:4])
	return f.setState(id, false)
}

func (f *fakeEngine) Restart(_ context.Context, id string, _ int) error {
	f.record("restart " + id[:4])
	return f.setState(id, true)
}

func (f *fakeEngine) Rename(_ context.Context, id, name string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.record("rename " + id[:4] + " " + name)
	c, err := f.find(id)
	if err != nil {
		return err
	}
	c.inspect.Name = "/" + name
	return nil
}

func (f *fakeEngine) Remove(_ context.Context, id string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.record("remove " + id[:4])
	for k, c := range f.containers {
		if c.inspect.ID == id || k == id {
			delete(f.containers, k)
		}
	}
	return nil
}

func (f *fakeEngine) Create(_ context.Context, name string, body map[string]any) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.nextID++
	id := fmt.Sprintf("new%d", f.nextID)
	f.record("create " + name + " " + body["Image"].(string))
	labels, _ := body["Labels"].(map[string]any)
	f.containers[id] = &fakeContainer{inspect: docker.Inspect{
		ID: id + strings.Repeat("0", 64-len(id)), Name: "/" + name,
		State:  docker.State{Status: "created", Health: &docker.Health{Status: f.newHealth}},
		Config: map[string]any{"Image": body["Image"], "Labels": labels},
	}}
	return f.containers[id].inspect.ID, nil
}

func (f *fakeEngine) Connect(_ context.Context, network, _ string, _ map[string]any) error {
	f.record("connect " + network)
	return nil
}

func (f *fakeEngine) InspectImage(_ context.Context, ref string) (*docker.Image, error) {
	if img, ok := f.images[ref]; ok {
		return img, nil
	}
	return &docker.Image{ID: "sha256:" + ref, Config: map[string]any{}}, nil
}

func (f *fakeEngine) Pull(_ context.Context, repo, tag string) error {
	f.record("pull " + repo + ":" + tag)
	return f.pullErr
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

func managed(service string, extra ...string) map[string]string {
	l := map[string]string{LabelManaged: "true", labelComposeService: service, labelComposeProject: "proj"}
	for i := 0; i+1 < len(extra); i += 2 {
		l[extra[i]] = extra[i+1]
	}
	return l
}

// world: a managed bot, a protected web, an unmanaged container, a one-off job
// from the bot image, a container from another compose project.
func world() *fakeEngine {
	f := newFake()
	f.add("bot1", "proj-bot-expenses-1", managed("bot-expenses", LabelKind, "bot"), "ghcr.io/o/bot:aaa", true)
	f.add("web1", "proj-web-1", managed("web", LabelProtected, "true"), "ghcr.io/o/web:aaa", true)
	f.add("raw1", "random-thing", map[string]string{"foo": "bar"}, "nginx:1", true)
	f.add("job1", "proj-bot-expenses-run-1", managed("bot-expenses", labelComposeOneoff, "True"), "ghcr.io/o/bot:aaa", true)
	f.add("oth1", "other-bot-1", map[string]string{LabelManaged: "true", labelComposeService: "other", labelComposeProject: "elsewhere"}, "x:1", true)
	return f
}

func newAgent(f *fakeEngine) *Agent {
	return New(f, sign.NewVerifier(secret), Config{Projects: []string{"proj"}, DeployTimeout: 3 * time.Second, Settle: time.Millisecond},
		slog.New(slog.NewTextHandler(io.Discard, nil)))
}

func nonce() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func call(t *testing.T, h http.Handler, method, path, body string, signed bool) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if signed {
		ts := time.Now().Unix()
		n := nonce()
		req.Header.Set(sign.HeaderTimestamp, strconv.FormatInt(ts, 10))
		req.Header.Set(sign.HeaderNonce, n)
		req.Header.Set(sign.HeaderSignature, sign.Sign(secret, ts, n, method, path, []byte(body)))
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

func TestCheckAction(t *testing.T) {
	plain := map[string]string{LabelManaged: "true"}
	protected := map[string]string{LabelManaged: "true", LabelProtected: "true"}
	unmanaged := map[string]string{LabelManaged: "false"}
	cases := []struct {
		labels map[string]string
		action string
		want   error
	}{
		{plain, "start", nil}, {plain, "stop", nil}, {plain, "restart", nil}, {plain, "deploy", nil},
		{protected, "start", nil}, {protected, "restart", nil},
		{protected, "stop", errProtected}, {protected, "deploy", errProtected},
		{unmanaged, "start", errNotFound}, {map[string]string{}, "restart", errNotFound},
		{plain, "exec", errBadAction}, {plain, "remove", errBadAction},
	}
	for _, c := range cases {
		if got := CheckAction(c.labels, c.action); !errors.Is(got, c.want) && got != c.want {
			t.Errorf("CheckAction(%v, %s) = %v, want %v", c.labels, c.action, got, c.want)
		}
	}
}

func TestSplitImage(t *testing.T) {
	cases := map[string][2]string{
		"ghcr.io/o/app:abc":                {"ghcr.io/o/app", "abc"},
		"ghcr.io/o/app":                    {"ghcr.io/o/app", "latest"},
		"localhost:5000/app":               {"localhost:5000/app", "latest"},
		"localhost:5000/app:v2":            {"localhost:5000/app", "v2"},
		"alpine:3.21@sha256:deadbeef":      {"alpine", "3.21"},
		"ghcr.io/o/app@sha256:deadbeef000": {"ghcr.io/o/app", "latest"},
	}
	for in, want := range cases {
		repo, tag := SplitImage(in)
		if repo != want[0] || tag != want[1] {
			t.Errorf("SplitImage(%q) = %q, %q; want %q, %q", in, repo, tag, want[0], want[1])
		}
	}
}

func TestRefusesUnsignedRequests(t *testing.T) {
	h := newAgent(world()).Handler()
	for _, p := range []string{"/services", "/services/bot-expenses/logs"} {
		if code, _ := call(t, h, "GET", p, "", false); code != http.StatusUnauthorized {
			t.Errorf("GET %s unsigned = %d", p, code)
		}
	}
	if code, _ := call(t, h, "POST", "/services/bot-expenses/stop", "", false); code != http.StatusUnauthorized {
		t.Errorf("unsigned stop = %d", code)
	}
	if code, _ := call(t, h, "GET", "/healthz", "", false); code != http.StatusOK {
		t.Errorf("healthz = %d", code)
	}
}

func TestListsOnlyManagedServicesOfTheProject(t *testing.T) {
	h := newAgent(world()).Handler()
	code, body := call(t, h, "GET", "/services", "", true)
	if code != 200 {
		t.Fatalf("status %d: %v", code, body)
	}
	var names []string
	for _, s := range body["services"].([]any) {
		svc := s.(map[string]any)
		names = append(names, svc["name"].(string))
		if svc["cpu_percent"] == nil {
			t.Errorf("%s: no stats", svc["name"])
		}
	}
	if !slices.Equal(names, []string{"bot-expenses", "web"}) {
		t.Fatalf("services = %v", names)
	}
}

// Two projects on one server, both with a "web": the primary keeps plain names,
// the second is qualified, and a third, unlisted project stays invisible.
func TestServesSeveralProjectsWithoutNameClashes(t *testing.T) {
	f := world()
	f.add("pweb1", "shiftella-web-1", map[string]string{LabelManaged: "true", labelComposeService: "web", labelComposeProject: "shiftella"}, "ghcr.io/o/planner:aaa", true)
	a := New(f, sign.NewVerifier(secret), Config{Projects: []string{"proj", "shiftella"}, DeployTimeout: 3 * time.Second, Settle: time.Millisecond},
		slog.New(slog.NewTextHandler(io.Discard, nil)))
	h := a.Handler()

	code, body := call(t, h, "GET", "/services", "", true)
	if code != 200 {
		t.Fatalf("status %d: %v", code, body)
	}
	var names []string
	for _, s := range body["services"].([]any) {
		names = append(names, s.(map[string]any)["name"].(string))
	}
	if !slices.Equal(names, []string{"bot-expenses", "shiftella.web", "web"}) {
		t.Fatalf("services = %v", names)
	}

	if code, body := call(t, h, "POST", "/services/shiftella.web/restart", "", true); code != 200 {
		t.Fatalf("restart shiftella.web = %d %v", code, body)
	}
	if code, _ := call(t, h, "POST", "/services/web/stop", "", true); code != 403 {
		t.Fatalf("protected primary web: stop = %d, want 403", code)
	}
	if code, _ := call(t, h, "POST", "/services/elsewhere.other/restart", "", true); code != 404 {
		t.Fatalf("unlisted project = %d, want 404", code)
	}
	restarted := false
	for _, c := range f.calls {
		// The fake records the first four characters of the container id.
		switch c {
		case "restart pweb":
			restarted = true
		case "restart web1":
			t.Errorf("restarted the primary project's web instead")
		}
	}
	if !restarted {
		t.Fatalf("shiftella web was not restarted; calls: %v", f.calls)
	}
}

func TestQualifiedName(t *testing.T) {
	l := map[string]string{labelComposeService: "web", labelComposeProject: "shiftella"}
	if got := QualifiedName(l, "x", "anwar-os"); got != "shiftella.web" {
		t.Errorf("other project = %q", got)
	}
	if got := QualifiedName(l, "x", "shiftella"); got != "web" {
		t.Errorf("primary project = %q", got)
	}
	if got := QualifiedName(l, "x", ""); got != "web" {
		t.Errorf("no project filter = %q", got)
	}
}

func TestLifecycleRules(t *testing.T) {
	f := world()
	h := newAgent(f).Handler()
	cases := []struct {
		path string
		code int
	}{
		{"/services/bot-expenses/stop", 200},
		{"/services/bot-expenses/start", 200},
		{"/services/bot-expenses/restart", 200},
		{"/services/web/restart", 200}, // protected: restart is allowed
		{"/services/web/start", 200},
		{"/services/web/stop", 403},
		{"/services/random-thing/restart", 404}, // unmanaged container, by name
		{"/services/other/restart", 404},        // other compose project
		{"/services/proj-bot-expenses-run-1/stop", 404},
		{"/services/bot-expenses/exec", 400},
		{"/services/nope/restart", 404},
	}
	for _, c := range cases {
		code, body := call(t, h, "POST", c.path, "", true)
		if code != c.code {
			t.Errorf("POST %s = %d %v, want %d", c.path, code, body, c.code)
		}
	}
	for _, c := range f.calls {
		if strings.HasPrefix(c, "stop web") || strings.Contains(c, "raw1") || strings.Contains(c, "oth1") || strings.Contains(c, "job1") {
			t.Errorf("forbidden engine call happened: %s", c)
		}
	}
}

func TestDeployRules(t *testing.T) {
	f := world()
	h := newAgent(f).Handler()
	if code, _ := call(t, h, "POST", "/services/web/deploy", `{"tag":"bbb"}`, true); code != 403 {
		t.Errorf("deploy protected = %d", code)
	}
	for _, body := range []string{`{"tag":""}`, `{"tag":"../etc"}`, `{"tag":"a b"}`, `{"tag":"-x"}`, `nope`, `{"tag":"` + strings.Repeat("a", 129) + `"}`} {
		if code, _ := call(t, h, "POST", "/services/bot-expenses/deploy", body, true); code != 400 {
			t.Errorf("deploy %s = %d", body, code)
		}
	}
	if code, _ := call(t, h, "POST", "/services/random-thing/deploy", `{"tag":"x"}`, true); code != 404 {
		t.Errorf("deploy unmanaged = %d", code)
	}
	for _, c := range f.calls {
		if strings.HasPrefix(c, "pull") {
			t.Errorf("refused deploy still pulled: %s", c)
		}
	}
}

func TestDeploySwapsTheContainer(t *testing.T) {
	f := world()
	h := newAgent(f).Handler()
	code, body := call(t, h, "POST", "/services/bot-expenses/deploy", `{"tag":"bbb"}`, true)
	if code != 200 || body["ok"] != true {
		t.Fatalf("deploy = %d %v", code, body)
	}
	if body["previous_tag"] != "aaa" || body["tag"] != "bbb" {
		t.Fatalf("tags: %v", body)
	}
	want := []string{
		"pull ghcr.io/o/bot:bbb",
		"rename bot1 proj-bot-expenses-1-ops-previous",
		"stop bot1",
		"create proj-bot-expenses-1 ghcr.io/o/bot:bbb",
		"start new1",
		"remove bot1",
	}
	if !slices.Equal(f.calls, want) {
		t.Fatalf("calls:\n%s\nwant:\n%s", strings.Join(f.calls, "\n"), strings.Join(want, "\n"))
	}
}

func TestDeployRollsBackWhenTheNewContainerIsUnhealthy(t *testing.T) {
	f := world()
	f.newHealth = "unhealthy"
	h := newAgent(f).Handler()
	code, body := call(t, h, "POST", "/services/bot-expenses/deploy", `{"tag":"bad"}`, true)
	if code != http.StatusBadGateway || body["ok"] != false || body["rolled_back"] != true {
		t.Fatalf("deploy = %d %v", code, body)
	}
	want := []string{
		"pull ghcr.io/o/bot:bad",
		"rename bot1 proj-bot-expenses-1-ops-previous",
		"stop bot1",
		"create proj-bot-expenses-1 ghcr.io/o/bot:bad",
		"start new1",
		"remove new1",
		"rename bot1 proj-bot-expenses-1",
		"start bot1",
	}
	if !slices.Equal(f.calls, want) {
		t.Fatalf("calls:\n%s\nwant:\n%s", strings.Join(f.calls, "\n"), strings.Join(want, "\n"))
	}
	c, _ := f.Inspect(context.Background(), "bot1")
	if !c.State.Running || c.ContainerName() != "proj-bot-expenses-1" {
		t.Fatalf("old container not restored: %+v", c.State)
	}
}

func TestDeployLeavesEverythingAloneWhenThePullFails(t *testing.T) {
	f := world()
	f.pullErr = errors.New("manifest unknown")
	h := newAgent(f).Handler()
	code, body := call(t, h, "POST", "/services/bot-expenses/deploy", `{"tag":"missing"}`, true)
	if code != http.StatusBadGateway || body["rolled_back"] != false || !strings.Contains(body["error"].(string), "manifest unknown") {
		t.Fatalf("deploy = %d %v", code, body)
	}
	if !slices.Equal(f.calls, []string{"pull ghcr.io/o/bot:missing"}) {
		t.Fatalf("calls: %v", f.calls)
	}
}

func TestRecreateBody(t *testing.T) {
	old := &docker.Inspect{
		ID: "0123456789abcdef0000",
		Config: map[string]any{
			"Image":       "ghcr.io/o/bot:aaa",
			"Hostname":    "0123456789ab",
			"Env":         []any{"BOT_TOKEN=x", "PATH=/usr/bin", "BOT_VERSION=aaa"},
			"Cmd":         []any{"python", "-m", "bot"},
			"Healthcheck": map[string]any{"Test": []any{"CMD", "true"}},
			"MacAddress":  "02:42:ac:11:00:02",
			"Labels": map[string]any{
				"os.managed": "true", "os.kind": "bot", "com.docker.compose.service": "bot-expenses",
				"com.docker.compose.image": "sha256:old", "org.opencontainers.image.revision": "aaa",
			},
		},
		HostConfig: map[string]any{"NetworkMode": "proj_internal", "ReadonlyRootfs": true, "Memory": json.Number("134217728")},
	}
	old.NetworkSettings.Networks = map[string]map[string]any{
		"proj_internal": {"Aliases": []any{"bot-expenses", "proj-bot-expenses-1", "0123456789ab"}, "IPAddress": "172.18.0.5", "NetworkID": "n1"},
		"proj_egress":   {"Aliases": []any{"bot-expenses"}},
	}
	oldImg := &docker.Image{ID: "sha256:old", Config: map[string]any{
		"Env":         []any{"PATH=/usr/bin", "BOT_VERSION=aaa"},
		"Cmd":         []any{"python", "-m", "bot"},
		"Healthcheck": map[string]any{"Test": []any{"CMD", "true"}},
		"Labels":      map[string]any{"os.managed": "true", "os.kind": "bot", "org.opencontainers.image.revision": "aaa"},
	}}
	newImg := &docker.Image{ID: "sha256:new"}

	body, extra := RecreateBody(old, oldImg, newImg, "ghcr.io/o/bot:bbb")

	if body["Image"] != "ghcr.io/o/bot:bbb" {
		t.Errorf("Image = %v", body["Image"])
	}
	if env := body["Env"].([]any); len(env) != 1 || env[0] != "BOT_TOKEN=x" {
		t.Errorf("Env = %v (image defaults must go, compose env must stay)", env)
	}
	for _, k := range []string{"Cmd", "Healthcheck", "Hostname", "MacAddress"} {
		if _, ok := body[k]; ok {
			t.Errorf("%s should be dropped", k)
		}
	}
	labels := body["Labels"].(map[string]any)
	if labels["com.docker.compose.service"] != "bot-expenses" || labels["com.docker.compose.image"] != "sha256:new" {
		t.Errorf("compose labels = %v", labels)
	}
	if _, ok := labels["org.opencontainers.image.revision"]; ok {
		t.Errorf("old image label kept: %v", labels)
	}
	host := body["HostConfig"].(map[string]any)
	if host["ReadonlyRootfs"] != true || host["Memory"].(json.Number).String() != "134217728" {
		t.Errorf("HostConfig not carried over exactly: %v", host)
	}
	eps := body["NetworkingConfig"].(map[string]any)["EndpointsConfig"].(map[string]any)
	ep := eps["proj_internal"].(map[string]any)
	if fmt.Sprint(ep["Aliases"]) != "[bot-expenses proj-bot-expenses-1]" {
		t.Errorf("aliases = %v", ep["Aliases"])
	}
	if _, ok := ep["IPAddress"]; ok {
		t.Errorf("assigned address carried over: %v", ep)
	}
	if len(extra) != 1 || extra[0].network != "proj_egress" {
		t.Errorf("extra networks = %v", extra)
	}
	// The source must not be mutated (it is used again for rollback).
	if old.Config["Image"] != "ghcr.io/o/bot:aaa" || len(old.Config["Env"].([]any)) != 3 {
		t.Errorf("old config mutated: %v", old.Config)
	}
}

func TestLogsEndpoint(t *testing.T) {
	h := newAgent(world()).Handler()
	code, body := call(t, h, "GET", "/services/bot-expenses/logs?tail=50", "", true)
	if code != 200 || len(body["lines"].([]any)) != 1 {
		t.Fatalf("logs = %d %v", code, body)
	}
	if code, _ := call(t, h, "GET", "/services/bot-expenses/logs?tail=-1", "", true); code != 400 {
		t.Errorf("bad tail = %d", code)
	}
	if code, _ := call(t, h, "GET", "/services/random-thing/logs", "", true); code != 404 {
		t.Errorf("unmanaged logs = %d", code)
	}
}

func TestRejectsLargeBodies(t *testing.T) {
	h := newAgent(world()).Handler()
	big := `{"tag":"` + string(bytes.Repeat([]byte("a"), maxBody)) + `"}`
	if code, _ := call(t, h, "POST", "/services/bot-expenses/deploy", big, true); code != http.StatusRequestEntityTooLarge {
		t.Errorf("large body = %d", code)
	}
}
