//go:build integration

// Integration test against a real Docker daemon (Docker Desktop locally):
//
//	go test -tags integration -run Integration -v .
//
// It starts throwaway alpine containers labelled like compose services of a
// fake project, drives them through the signed HTTP API, and removes them.
package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/nnnotanwar/anwarnnnot/services/ops-agent/internal/agent"
	"github.com/nnnotanwar/anwarnnnot/services/ops-agent/internal/docker"
	"github.com/nnnotanwar/anwarnnnot/services/ops-agent/internal/sign"
)

var itSecret = []byte("integration-secret-0123456789abcdef0123")

func dockerCLI(t *testing.T, args ...string) string {
	t.Helper()
	out, err := exec.Command("docker", args...).CombinedOutput()
	if err != nil {
		t.Fatalf("docker %s: %v\n%s", strings.Join(args, " "), err, out)
	}
	return strings.TrimSpace(string(out))
}

func socket() string {
	if s := os.Getenv("DOCKER_SOCKET"); s != "" {
		return s
	}
	return "/var/run/docker.sock"
}

type client struct {
	t   *testing.T
	url string
}

func (c client) do(method, path, body string) (int, map[string]any) {
	c.t.Helper()
	req, _ := http.NewRequest(method, c.url+path, strings.NewReader(body))
	ts := time.Now().Unix()
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	n := hex.EncodeToString(b)
	req.Header.Set(sign.HeaderTimestamp, strconv.FormatInt(ts, 10))
	req.Header.Set(sign.HeaderNonce, n)
	req.Header.Set(sign.HeaderSignature, sign.Sign(itSecret, ts, n, method, path, []byte(body)))
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return res.StatusCode, out
}

func TestIntegration(t *testing.T) {
	if _, err := os.Stat(socket()); err != nil {
		t.Skip("no Docker socket")
	}
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	project := "opsagent-it-" + hex.EncodeToString(b)
	net := project + "_internal"

	dockerCLI(t, "pull", "-q", "alpine:3.20")
	dockerCLI(t, "network", "create", net)
	t.Cleanup(func() {
		ids, _ := exec.Command("docker", "ps", "-aq", "--filter", "label=com.docker.compose.project="+project).Output()
		for _, id := range strings.Fields(string(ids)) {
			_ = exec.Command("docker", "rm", "-f", id).Run()
		}
		_ = exec.Command("docker", "network", "rm", net).Run()
	})

	run := func(service string, extra ...string) {
		args := []string{"run", "-d", "--name", project + "-" + service + "-1", "--network", net, "--network-alias", service,
			"--label", "com.docker.compose.project=" + project, "--label", "com.docker.compose.service=" + service,
			"--env", "KEEP_ME=yes", "--memory", "64m", "--stop-timeout", "2"}
		args = append(args, extra...)
		dockerCLI(t, args...)
	}
	// Healthy only on Alpine 3.20: deploying 3.21 must fail and roll back.
	run("bot", "--label", "os.managed=true", "--label", "os.kind=bot",
		"--health-cmd", "grep -q '^3\\.20' /etc/alpine-release", "--health-interval", "1s", "--health-start-period", "1s",
		"alpine:3.20", "sh", "-c", "echo bot started; echo oops >&2; exec sleep 3600")
	// Healthy on any version: deploying 3.21 must succeed.
	run("worker", "--label", "os.managed=true",
		"--health-cmd", "test -f /etc/alpine-release", "--health-interval", "1s", "--health-start-period", "1s",
		"alpine:3.20", "sh", "-c", "echo worker up; exec sleep 3600")
	run("db", "--label", "os.managed=true", "--label", "os.protected=true", "alpine:3.20", "sleep", "3600")
	run("unmanaged", "alpine:3.20", "sleep", "3600")

	eng := docker.New(socket())
	a := agent.New(eng, sign.NewVerifier(itSecret), agent.Config{Project: project, DeployTimeout: 60 * time.Second, Settle: 2 * time.Second, Version: "it"},
		slog.New(slog.NewTextHandler(io.Discard, nil)))
	srv := httptest.NewServer(a.Handler())
	defer srv.Close()
	c := client{t: t, url: srv.URL}

	waitHealthy := func(service string) {
		t.Helper()
		for i := 0; i < 30; i++ {
			_, s := c.do("GET", "/services/"+service, "")
			if s["health"] == "healthy" {
				return
			}
			time.Sleep(time.Second)
		}
		t.Fatalf("%s never became healthy", service)
	}
	waitHealthy("bot")
	waitHealthy("worker")

	t.Run("lists only managed containers of the project", func(t *testing.T) {
		code, body := c.do("GET", "/services", "")
		if code != 200 {
			t.Fatalf("%d %v", code, body)
		}
		var names []string
		for _, s := range body["services"].([]any) {
			svc := s.(map[string]any)
			names = append(names, svc["name"].(string))
			if svc["name"] == "bot" && (svc["tag"] != "3.20" || svc["image"] != "alpine" || svc["state"] != "running") {
				t.Errorf("bot = %v", svc)
			}
		}
		if strings.Join(names, ",") != "bot,db,worker" {
			t.Fatalf("services = %v", names)
		}
	})

	t.Run("reads logs from both streams", func(t *testing.T) {
		code, body := c.do("GET", "/services/bot/logs?tail=10", "")
		if code != 200 {
			t.Fatalf("%d %v", code, body)
		}
		var streams []string
		for _, l := range body["lines"].([]any) {
			line := l.(map[string]any)
			streams = append(streams, line["stream"].(string)+":"+line["text"].(string))
			if line["ts"] == "" {
				t.Errorf("no timestamp: %v", line)
			}
		}
		joined := strings.Join(streams, "|")
		if !strings.Contains(joined, "stdout:bot started") || !strings.Contains(joined, "stderr:oops") {
			t.Fatalf("lines = %s", joined)
		}
	})

	t.Run("refuses protected and unmanaged containers", func(t *testing.T) {
		if code, _ := c.do("POST", "/services/db/stop", ""); code != 403 {
			t.Errorf("stop db = %d", code)
		}
		if code, _ := c.do("POST", "/services/db/deploy", `{"tag":"3.21"}`); code != 403 {
			t.Errorf("deploy db = %d", code)
		}
		if code, _ := c.do("POST", "/services/unmanaged/stop", ""); code != 404 {
			t.Errorf("stop unmanaged = %d", code)
		}
		if state := dockerCLI(t, "inspect", "-f", "{{.State.Status}}", project+"-db-1"); state != "running" {
			t.Errorf("db state = %s", state)
		}
	})

	t.Run("stops, starts and restarts", func(t *testing.T) {
		code, body := c.do("POST", "/services/worker/stop", "")
		if code != 200 || body["service"].(map[string]any)["state"] != "exited" {
			t.Fatalf("stop = %d %v", code, body)
		}
		code, body = c.do("POST", "/services/worker/start", "")
		if code != 200 || body["service"].(map[string]any)["state"] != "running" {
			t.Fatalf("start = %d %v", code, body)
		}
		code, body = c.do("POST", "/services/worker/restart", "")
		if code != 200 || body["service"].(map[string]any)["state"] != "running" {
			t.Fatalf("restart = %d %v", code, body)
		}
		waitHealthy("worker")
	})

	t.Run("deploys a new tag and keeps config, env and network alias", func(t *testing.T) {
		code, body := c.do("POST", "/services/worker/deploy", `{"tag":"3.21"}`)
		if code != 200 || body["ok"] != true {
			t.Fatalf("deploy = %d %v", code, body)
		}
		name := project + "-worker-1"
		if img := dockerCLI(t, "inspect", "-f", "{{.Config.Image}}", name); img != "alpine:3.21" {
			t.Errorf("image = %s", img)
		}
		env := dockerCLI(t, "inspect", "-f", "{{json .Config.Env}}", name)
		if !strings.Contains(env, "KEEP_ME=yes") {
			t.Errorf("env = %s", env)
		}
		if mem := dockerCLI(t, "inspect", "-f", "{{.HostConfig.Memory}}", name); mem != strconv.Itoa(64<<20) {
			t.Errorf("memory = %s", mem)
		}
		aliases := dockerCLI(t, "inspect", "-f", "{{json (index .NetworkSettings.Networks \""+net+"\").Aliases}}", name)
		if !strings.Contains(aliases, `"worker"`) {
			t.Errorf("aliases = %s", aliases)
		}
		if out := dockerCLI(t, "ps", "-a", "--filter", "name="+name+"-ops-previous", "-q"); out != "" {
			t.Errorf("old container left: %s", out)
		}
	})

	t.Run("rolls back when the new tag never gets healthy", func(t *testing.T) {
		before := dockerCLI(t, "inspect", "-f", "{{.Id}}", project+"-bot-1")
		code, body := c.do("POST", "/services/bot/deploy", `{"tag":"3.21"}`)
		if code != 502 || body["ok"] != false || body["rolled_back"] != true {
			t.Fatalf("deploy = %d %v", code, body)
		}
		after := dockerCLI(t, "inspect", "-f", "{{.Id}} {{.State.Status}} {{.Config.Image}}", project+"-bot-1")
		if after != before+" running alpine:3.20" {
			t.Fatalf("after rollback: %s (before %s)", after, before)
		}
	})

	t.Run("reports a missing tag without touching the container", func(t *testing.T) {
		before := dockerCLI(t, "inspect", "-f", "{{.Id}}", project+"-worker-1")
		code, body := c.do("POST", "/services/worker/deploy", `{"tag":"does-not-exist-0"}`)
		if code != 502 || body["rolled_back"] != false {
			t.Fatalf("deploy = %d %v", code, body)
		}
		if after := dockerCLI(t, "inspect", "-f", "{{.Id}}", project+"-worker-1"); after != before {
			t.Fatalf("container replaced")
		}
	})
}
