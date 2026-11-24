package host

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/nnnotanwar/anwar-os/services/ops-agent/internal/docker"
)

func write(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

type fakeDocker struct {
	dfCalls int
	dfErr   error
	infoErr error
}

func (f *fakeDocker) Info(context.Context) (*docker.Info, error) {
	if f.infoErr != nil {
		return nil, f.infoErr
	}
	return &docker.Info{Name: "anwar-os", OperatingSystem: "Ubuntu 24.04.1 LTS", KernelVersion: "6.8.0-docker", Architecture: "aarch64", NCPU: 2, ServerVersion: "28.0.1"}, nil
}

func (f *fakeDocker) DiskUsage(context.Context) (*docker.DiskUsage, error) {
	f.dfCalls++
	if f.dfErr != nil {
		return nil, f.dfErr
	}
	return &docker.DiskUsage{ImagesBytes: 3 << 30, TotalBytes: 4 << 30}, nil
}

const meminfo = `MemTotal:        3884000 kB
MemFree:          200000 kB
MemAvailable:    1942000 kB
Buffers:           10000 kB
Cached:           900000 kB
SwapTotal:       2097148 kB
SwapFree:        1572864 kB
`

func fixture(t *testing.T) (Config, string) {
	t.Helper()
	root := t.TempDir()
	proc := filepath.Join(root, "proc")
	write(t, filepath.Join(proc, "uptime"), "90061.42 170000.00\n")
	write(t, filepath.Join(proc, "loadavg"), "0.42 0.30 0.25 1/321 4567\n")
	write(t, filepath.Join(proc, "meminfo"), meminfo)
	write(t, filepath.Join(proc, "pressure/memory"), "some avg10=0.00 avg60=1.50 avg300=0.40 total=123\nfull avg10=0.00 avg60=0.20 avg300=0.02 total=45\n")
	write(t, filepath.Join(proc, "sys/kernel/osrelease"), "6.8.0-49-generic\n")

	run := filepath.Join(root, "run")
	write(t, filepath.Join(run, "reboot-required"), "*** System restart required ***\n")
	write(t, filepath.Join(run, "reboot-required.pkgs"), "linux-image-6.8.0-50-generic\nlibc6\nlibc6\n")
	since := time.Date(2026, 11, 20, 6, 12, 0, 0, time.UTC)
	if err := os.Chtimes(filepath.Join(run, "reboot-required"), since, since); err != nil {
		t.Fatal(err)
	}

	backup := filepath.Join(root, "backup")
	write(t, filepath.Join(backup, "last.json"), `{"status":"failed","started_at":"2026-11-24T02:15:00Z","finished_at":"2026-11-24T02:15:09Z","offsite":false,"error":"failed while uploading (exit 1)"}`)
	write(t, filepath.Join(backup, "last-success.json"), `{"status":"ok","started_at":"2026-11-23T02:15:00Z","finished_at":"2026-11-23T02:16:10Z","file":"anwar_os-2026-11-23T021500Z.dump.age","size_bytes":5242880,"offsite":true}`)

	sites := filepath.Join(root, "sites")
	write(t, filepath.Join(sites, "anwar-os.caddy"), "anwar-os.com {\n\treverse_proxy anwar-os-web:3000\n}\nwww.anwar-os.com {\n\tredir https://anwar-os.com{uri}\n}\n")
	write(t, filepath.Join(sites, "shiftella.caddy"), "shiftella.app, www.shiftella.app {\n\tfile_server\n}\ndev.shiftella.app {\n\tbasic_auth {\n\t\tdev hash\n\t}\n}\n")
	write(t, filepath.Join(sites, "notes.txt"), "ignored.example.com {\n}\n")

	return Config{Proc: proc, DiskPath: root, RunDir: run, BackupDir: backup, SitesDir: sites}, root
}

func TestCollectReadsEverySource(t *testing.T) {
	cfg, _ := fixture(t)
	c := New(cfg, &fakeDocker{})
	c.now = func() time.Time { return time.Date(2026, 11, 24, 12, 0, 0, 0, time.UTC) }
	r := c.Collect(context.Background())

	if len(r.Errors) != 0 {
		t.Fatalf("errors: %v", r.Errors)
	}
	if r.Hostname != "anwar-os" || r.OS != "Ubuntu 24.04.1 LTS" || r.Arch != "aarch64" || r.CPUs != 2 || r.DockerVersion != "28.0.1" {
		t.Errorf("info: %+v", r)
	}
	if r.Kernel != "6.8.0-49-generic" {
		t.Errorf("kernel = %q (want /proc, not Docker's)", r.Kernel)
	}
	if r.UptimeSeconds == nil || *r.UptimeSeconds != 90061 || r.BootTime != "2026-11-23T10:58:59Z" {
		t.Errorf("uptime = %v boot = %s", r.UptimeSeconds, r.BootTime)
	}
	if !reflect.DeepEqual(r.Load, []float64{0.42, 0.30, 0.25}) {
		t.Errorf("load = %v", r.Load)
	}
	m := r.Memory
	if m == nil || m.TotalBytes != 3884000*1024 || m.AvailableBytes != 1942000*1024 || m.UsedBytes != 1942000*1024 ||
		m.SwapTotalBytes != 2097148*1024 || m.SwapUsedBytes != (2097148-1572864)*1024 {
		t.Errorf("memory = %+v", m)
	}
	if m.PSISomeAvg60 == nil || *m.PSISomeAvg60 != 1.5 || m.PSIFullAvg60 == nil || *m.PSIFullAvg60 != 0.2 {
		t.Errorf("psi = %v %v", m.PSISomeAvg60, m.PSIFullAvg60)
	}
	if r.Disk == nil || r.Disk.TotalBytes == 0 || r.Disk.UsedPercent < 0 || r.Disk.UsedPercent > 100 {
		t.Errorf("disk = %+v", r.Disk)
	}
	if r.DockerDisk == nil || r.DockerDisk.TotalBytes != 4<<30 {
		t.Errorf("docker disk = %+v", r.DockerDisk)
	}
	if r.Reboot == nil || !r.Reboot.Required || r.Reboot.Since != "2026-11-20T06:12:00Z" ||
		!reflect.DeepEqual(r.Reboot.Packages, []string{"linux-image-6.8.0-50-generic", "libc6"}) {
		t.Errorf("reboot = %+v", r.Reboot)
	}
	b := r.Backup
	if b == nil || b.Last == nil || b.Last.Status != "failed" || b.Last.Error == "" ||
		b.LastSuccess == nil || b.LastSuccess.SizeBytes != 5242880 || !b.LastSuccess.Offsite {
		t.Errorf("backup = %+v", b)
	}
	if want := []string{"anwar-os.com", "dev.shiftella.app", "shiftella.app", "www.anwar-os.com", "www.shiftella.app"}; !reflect.DeepEqual(r.Sites, want) {
		t.Errorf("sites = %v", r.Sites)
	}
}

func TestCollectWithoutMountsReportsWhy(t *testing.T) {
	cfg, root := fixture(t)
	cfg.RunDir = ""
	cfg.BackupDir = filepath.Join(root, "missing")
	cfg.SitesDir = ""
	cfg.Proc = filepath.Join(root, "no-proc")
	c := New(cfg, &fakeDocker{infoErr: errors.New("docker: 500 boom"), dfErr: errors.New("docker: 500 boom")})
	r := c.Collect(context.Background())

	for _, section := range []string{"reboot", "backup", "sites", "uptime", "load", "memory", "docker", "docker_disk"} {
		if r.Errors[section] == "" {
			t.Errorf("no error for %s: %v", section, r.Errors)
		}
	}
	if r.Errors["reboot"] != "not mounted" || r.Errors["backup"] != "not mounted" {
		t.Errorf("errors = %v", r.Errors)
	}
	if r.Reboot != nil || r.Backup != nil || r.Memory != nil || r.Load != nil || r.UptimeSeconds != nil || r.DockerDisk != nil {
		t.Errorf("sections should be null: %+v", r)
	}
	if r.Sites == nil {
		t.Errorf("sites must be an empty list, not null")
	}
	if r.Disk == nil { // statfs of an existing directory still works
		t.Errorf("disk = nil (%v)", r.Errors["disk"])
	}
}

func TestNoRebootAndNoBackupYet(t *testing.T) {
	cfg, root := fixture(t)
	_ = os.Remove(filepath.Join(cfg.RunDir, "reboot-required"))
	cfg.BackupDir = filepath.Join(root, "empty-backup")
	if err := os.Mkdir(cfg.BackupDir, 0o755); err != nil {
		t.Fatal(err)
	}
	r := New(cfg, &fakeDocker{}).Collect(context.Background())
	if r.Reboot == nil || r.Reboot.Required || r.Reboot.Packages == nil {
		t.Errorf("reboot = %+v", r.Reboot)
	}
	if r.Backup == nil || r.Backup.Last != nil || r.Backup.LastSuccess != nil {
		t.Errorf("backup = %+v (%v)", r.Backup, r.Errors)
	}
}

func TestBrokenBackupStatus(t *testing.T) {
	cfg, _ := fixture(t)
	write(t, filepath.Join(cfg.BackupDir, "last.json"), "{not json")
	r := New(cfg, &fakeDocker{}).Collect(context.Background())
	if r.Backup != nil || !strings.Contains(r.Errors["backup"], "last.json") {
		t.Errorf("backup = %+v err = %q", r.Backup, r.Errors["backup"])
	}
}

func TestDockerDiskUsageIsCached(t *testing.T) {
	cfg, _ := fixture(t)
	d := &fakeDocker{}
	c := New(cfg, d)
	now := time.Date(2026, 11, 24, 12, 0, 0, 0, time.UTC)
	c.now = func() time.Time { return now }
	c.Collect(context.Background())
	c.Collect(context.Background())
	if d.dfCalls != 1 {
		t.Fatalf("df calls = %d, want 1 (cached)", d.dfCalls)
	}
	now = now.Add(11 * time.Minute)
	d.dfErr = errors.New("slow daemon")
	r := c.Collect(context.Background())
	if d.dfCalls != 2 || r.DockerDisk == nil || r.Errors["docker_disk"] != "" {
		t.Fatalf("calls = %d, df = %+v, err = %q: a failed refresh should serve the last answer", d.dfCalls, r.DockerDisk, r.Errors["docker_disk"])
	}
}

func TestParsers(t *testing.T) {
	if _, err := ParseLoadavg("0.1 0.2"); err == nil {
		t.Error("short loadavg accepted")
	}
	if _, err := ParseMeminfo("MemFree: 1 kB\n"); err == nil {
		t.Error("meminfo without MemTotal accepted")
	}
	m, err := ParseMeminfo("MemTotal: 1000 kB\nMemFree: 100 kB\nBuffers: 50 kB\nCached: 250 kB\n")
	if err != nil || m.AvailableBytes != 400*1024 || m.SwapTotalBytes != 0 {
		t.Errorf("old-kernel meminfo = %+v %v", m, err)
	}
	if some, full := ParsePressure(""); some != nil || full != nil {
		t.Error("empty pressure parsed")
	}
}

func TestParseSites(t *testing.T) {
	caddyfile := `
# a comment { with a brace
{
	email admin@example.com
}

(security_headers) {
	header X-Frame-Options DENY
}

example.com, www.example.com {
	import security_headers
	handle /api/* {
		respond 404
	}
	@foo {
		path /foo
	}
}

https://secure.example.org:443 {
	respond ok
}
http://plain.example.org, :8080, 127.0.0.1, localhost, *.wild.example.com, {$DOMAIN} {
	respond no
}
api.example.net:8443 {
	respond other port
}
Mixed.Example.COM. { # trailing comment
}
`
	got := ParseSites(caddyfile)
	want := []string{"example.com", "www.example.com", "secure.example.org", "mixed.example.com"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v\nwant %v", got, want)
	}
}
