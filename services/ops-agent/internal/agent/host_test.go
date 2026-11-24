package agent

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"testing"
	"time"

	"github.com/nnnotanwar/anwar-os/services/ops-agent/internal/host"
	"github.com/nnnotanwar/anwar-os/services/ops-agent/internal/sign"
)

type fakeHost struct{ calls int }

func (f *fakeHost) Collect(context.Context) *host.Report {
	f.calls++
	return &host.Report{Time: "2026-11-24T12:00:00Z", Hostname: "anwar-os", Sites: []string{"anwar-os.com"},
		Errors: map[string]string{"backup": "not mounted"}}
}

func TestHostReport(t *testing.T) {
	fh := &fakeHost{}
	a := New(world(), sign.NewVerifier(secret), Config{Projects: []string{"proj"}, Host: fh, Version: "v1", DeployTimeout: time.Second},
		slog.New(slog.NewTextHandler(io.Discard, nil)))
	h := a.Handler()

	if code, _ := call(t, h, "GET", "/host", "", false); code != http.StatusUnauthorized {
		t.Fatalf("unsigned /host = %d", code)
	}
	if fh.calls != 0 {
		t.Fatalf("collected for an unsigned request")
	}
	code, body := call(t, h, "GET", "/host", "", true)
	if code != http.StatusOK {
		t.Fatalf("/host = %d %v", code, body)
	}
	hostBody := body["host"].(map[string]any)
	if hostBody["hostname"] != "anwar-os" || hostBody["errors"].(map[string]any)["backup"] != "not mounted" {
		t.Errorf("host = %v", hostBody)
	}
	if body["agent"].(map[string]any)["version"] != "v1" {
		t.Errorf("agent = %v", body["agent"])
	}
	if code, _ := call(t, h, "POST", "/host", "", true); code != http.StatusMethodNotAllowed {
		t.Errorf("POST /host = %d", code)
	}
}

func TestHostReportDisabled(t *testing.T) {
	code, body := call(t, newAgent(world()).Handler(), "GET", "/host", "", true)
	if code != http.StatusNotFound || body["error"] != "not_found" {
		t.Fatalf("/host without a collector = %d %v", code, body)
	}
}
