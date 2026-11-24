// Package host collects the server's vital signs for the control panel's
// "Server" section (GET /host): disk, memory, load, uptime, kernel, a pending
// reboot, Docker's disk usage, the last backup and the domains the edge serves.
//
// Sources, all read-only:
//   - /proc of the agent's own container. meminfo, loadavg, uptime, pressure
//     and the kernel release are not namespaced, so they describe the host.
//   - statfs of DiskPath ("/" = the overlay root, which reports the host
//     filesystem holding /var/lib/docker: on the server, the root disk).
//   - the Docker Engine API (/info, /system/df), cached for DFCacheFor.
//   - bind mounts set up in infra/compose.prod.yml: the host's /run
//     (reboot-required), the backup status directory written by
//     infra/backup/backup.sh, and the edge site files (/opt/edge/sites).
//
// Every section is optional: a source that can't be read leaves its section
// null and says why in Errors, and the rest of the report still arrives.
package host

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/nnnotanwar/anwar-os/services/ops-agent/internal/docker"
)

// Docker is the part of the Engine API the collector uses (a fake in tests).
type Docker interface {
	Info(ctx context.Context) (*docker.Info, error)
	DiskUsage(ctx context.Context) (*docker.DiskUsage, error)
}

type Config struct {
	Proc      string // "/proc"
	DiskPath  string // "/"
	RunDir    string // host /run mounted read-only; "" = not mounted
	BackupDir string // backup status directory (last.json, last-success.json); "" = not mounted
	SitesDir  string // edge site files (*.caddy); "" = not mounted
	// DFCacheFor keeps `docker system df` that long (it walks every volume).
	DFCacheFor time.Duration
}

type Collector struct {
	cfg    Config
	docker Docker
	now    func() time.Time

	mu   sync.Mutex
	df   *docker.DiskUsage
	dfAt time.Time
}

func New(cfg Config, d Docker) *Collector {
	if cfg.Proc == "" {
		cfg.Proc = "/proc"
	}
	if cfg.DiskPath == "" {
		cfg.DiskPath = "/"
	}
	if cfg.DFCacheFor == 0 {
		cfg.DFCacheFor = 10 * time.Minute
	}
	return &Collector{cfg: cfg, docker: d, now: time.Now}
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

type Memory struct {
	TotalBytes     uint64 `json:"total_bytes"`
	AvailableBytes uint64 `json:"available_bytes"`
	UsedBytes      uint64 `json:"used_bytes"`
	SwapTotalBytes uint64 `json:"swap_total_bytes"`
	SwapUsedBytes  uint64 `json:"swap_used_bytes"`
	// Pressure stall information (/proc/pressure/memory): the share of the last
	// 60 s in which some / all tasks waited for memory. Null without PSI.
	PSISomeAvg60 *float64 `json:"psi_some_avg60"`
	PSIFullAvg60 *float64 `json:"psi_full_avg60"`
}

type Disk struct {
	Path           string  `json:"path"`
	TotalBytes     uint64  `json:"total_bytes"`
	UsedBytes      uint64  `json:"used_bytes"`
	AvailableBytes uint64  `json:"available_bytes"`
	UsedPercent    float64 `json:"used_percent"` // like df: used / (used + available)
}

type Reboot struct {
	Required bool     `json:"required"`
	Since    string   `json:"since,omitempty"` // when /run/reboot-required appeared
	Packages []string `json:"packages"`
}

// BackupRun is one run as infra/backup/backup.sh records it.
type BackupRun struct {
	Status     string `json:"status"` // ok | failed
	StartedAt  string `json:"started_at,omitempty"`
	FinishedAt string `json:"finished_at,omitempty"`
	File       string `json:"file,omitempty"`
	SizeBytes  int64  `json:"size_bytes,omitempty"`
	Offsite    bool   `json:"offsite"`
	Error      string `json:"error,omitempty"`
}

type Backup struct {
	Last        *BackupRun `json:"last"`         // the latest run, ok or failed
	LastSuccess *BackupRun `json:"last_success"` // the latest ok run
}

type Report struct {
	Time          string            `json:"time"`
	Hostname      string            `json:"hostname,omitempty"`
	OS            string            `json:"os,omitempty"`
	Kernel        string            `json:"kernel,omitempty"`
	Arch          string            `json:"arch,omitempty"`
	CPUs          int               `json:"cpus,omitempty"`
	DockerVersion string            `json:"docker_version,omitempty"`
	UptimeSeconds *int64            `json:"uptime_seconds"`
	BootTime      string            `json:"boot_time,omitempty"`
	Load          []float64         `json:"load"` // 1, 5, 15 min; null when unknown
	Memory        *Memory           `json:"memory"`
	Disk          *Disk             `json:"disk"`
	DockerDisk    *docker.DiskUsage `json:"docker_disk"`
	Reboot        *Reboot           `json:"reboot"`
	Backup        *Backup           `json:"backup"`
	Sites         []string          `json:"sites"` // domains in the edge site files
	Errors        map[string]string `json:"errors"`
}

// Collect reads every source; it never fails as a whole.
func (c *Collector) Collect(ctx context.Context) *Report {
	now := c.now().UTC()
	r := &Report{Time: now.Format(time.RFC3339), Errors: map[string]string{}, Sites: []string{}}
	fail := func(section string, err error) { r.Errors[section] = err.Error() }

	var info *docker.Info
	var df *docker.DiskUsage
	var infoErr, dfErr error
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		ictx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		info, infoErr = c.docker.Info(ictx)
	}()
	go func() {
		defer wg.Done()
		df, dfErr = c.diskUsage(ctx)
	}()

	if v, err := c.readTrim("sys/kernel/osrelease"); err == nil {
		r.Kernel = v
	}
	if raw, err := c.readProc("uptime"); err != nil {
		fail("uptime", err)
	} else if secs, err := ParseUptime(raw); err != nil {
		fail("uptime", err)
	} else {
		s := int64(secs)
		r.UptimeSeconds = &s
		r.BootTime = now.Add(-time.Duration(s) * time.Second).Format(time.RFC3339)
	}
	if raw, err := c.readProc("loadavg"); err != nil {
		fail("load", err)
	} else if load, err := ParseLoadavg(raw); err != nil {
		fail("load", err)
	} else {
		r.Load = load[:]
	}
	if raw, err := c.readProc("meminfo"); err != nil {
		fail("memory", err)
	} else if mem, err := ParseMeminfo(raw); err != nil {
		fail("memory", err)
	} else {
		if psi, err := c.readProc("pressure/memory"); err == nil {
			mem.PSISomeAvg60, mem.PSIFullAvg60 = ParsePressure(psi)
		}
		r.Memory = mem
	}
	if d, err := statDisk(c.cfg.DiskPath); err != nil {
		fail("disk", err)
	} else {
		r.Disk = d
	}
	if rb, err := c.reboot(); err != nil {
		fail("reboot", err)
	} else {
		r.Reboot = rb
	}
	if b, err := c.backup(); err != nil {
		fail("backup", err)
	} else {
		r.Backup = b
	}
	if sites, err := c.sites(); err != nil {
		fail("sites", err)
	} else {
		r.Sites = sites
	}

	wg.Wait()
	if infoErr != nil {
		fail("docker", infoErr)
	} else {
		r.Hostname, r.OS, r.Arch, r.CPUs, r.DockerVersion = info.Name, info.OperatingSystem, info.Architecture, info.NCPU, info.ServerVersion
		if r.Kernel == "" {
			r.Kernel = info.KernelVersion
		}
	}
	if dfErr != nil {
		fail("docker_disk", dfErr)
	} else {
		r.DockerDisk = df
	}
	return r
}

// diskUsage serves `docker system df` from the cache while it is fresh; a
// failed refresh falls back to the last good answer.
func (c *Collector) diskUsage(ctx context.Context) (*docker.DiskUsage, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.df != nil && c.now().Sub(c.dfAt) < c.cfg.DFCacheFor {
		return c.df, nil
	}
	dctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	df, err := c.docker.DiskUsage(dctx)
	if err != nil {
		if c.df != nil {
			return c.df, nil
		}
		return nil, err
	}
	c.df, c.dfAt = df, c.now()
	return df, nil
}

func (c *Collector) readProc(name string) (string, error) {
	raw, err := os.ReadFile(filepath.Join(c.cfg.Proc, name))
	return string(raw), err
}

func (c *Collector) readTrim(name string) (string, error) {
	s, err := c.readProc(name)
	return strings.TrimSpace(s), err
}

var errNotMounted = errors.New("not mounted")

func dirReady(dir string) error {
	if dir == "" {
		return errNotMounted
	}
	st, err := os.Stat(dir)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return errNotMounted
		}
		return err
	}
	if !st.IsDir() {
		return fmt.Errorf("%s is not a directory", dir)
	}
	return nil
}

// reboot reads Ubuntu's flag file (update-notifier / unattended-upgrades write
// /run/reboot-required and the packages that asked for it).
func (c *Collector) reboot() (*Reboot, error) {
	if err := dirReady(c.cfg.RunDir); err != nil {
		return nil, err
	}
	r := &Reboot{Packages: []string{}}
	st, err := os.Stat(filepath.Join(c.cfg.RunDir, "reboot-required"))
	if errors.Is(err, fs.ErrNotExist) {
		return r, nil
	}
	if err != nil {
		return nil, err
	}
	r.Required = true
	r.Since = st.ModTime().UTC().Format(time.RFC3339)
	if raw, err := os.ReadFile(filepath.Join(c.cfg.RunDir, "reboot-required.pkgs")); err == nil {
		seen := map[string]bool{}
		for _, line := range strings.Split(string(raw), "\n") {
			if p := strings.TrimSpace(line); p != "" && !seen[p] {
				seen[p] = true
				r.Packages = append(r.Packages, p)
			}
		}
	}
	return r, nil
}

func (c *Collector) backup() (*Backup, error) {
	if err := dirReady(c.cfg.BackupDir); err != nil {
		return nil, err
	}
	b := &Backup{}
	var err error
	if b.Last, err = readRun(filepath.Join(c.cfg.BackupDir, "last.json")); err != nil {
		return nil, err
	}
	if b.LastSuccess, err = readRun(filepath.Join(c.cfg.BackupDir, "last-success.json")); err != nil {
		return nil, err
	}
	return b, nil
}

// readRun returns nil (no error) when the file doesn't exist yet.
func readRun(path string) (*BackupRun, error) {
	raw, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var run BackupRun
	if err := json.Unmarshal(raw, &run); err != nil {
		return nil, fmt.Errorf("%s: %w", filepath.Base(path), err)
	}
	return &run, nil
}

func (c *Collector) sites() ([]string, error) {
	if err := dirReady(c.cfg.SitesDir); err != nil {
		return nil, err
	}
	files, err := filepath.Glob(filepath.Join(c.cfg.SitesDir, "*.caddy"))
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	out := []string{}
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			return nil, err
		}
		for _, d := range ParseSites(string(raw)) {
			if !seen[d] {
				seen[d] = true
				out = append(out, d)
			}
		}
	}
	sort.Strings(out)
	return out, nil
}

func round1(v float64) float64 { return math.Round(v*10) / 10 }
