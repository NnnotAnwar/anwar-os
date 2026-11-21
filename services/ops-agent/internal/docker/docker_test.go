package docker

import (
	"bytes"
	"encoding/binary"
	"strings"
	"testing"
)

func frame(stream byte, s string) []byte {
	hdr := make([]byte, 8)
	hdr[0] = stream
	binary.BigEndian.PutUint32(hdr[4:], uint32(len(s)))
	return append(hdr, s...)
}

func TestDemux(t *testing.T) {
	var buf bytes.Buffer
	buf.Write(frame(1, "2026-11-16T10:00:00.000000001Z started\n2026-11-16T10:00:01.000000001Z par"))
	buf.Write(frame(2, "2026-11-16T10:00:02.000000001Z boom\n"))
	buf.Write(frame(1, "tial line\n"))
	lines, err := demux(&buf)
	if err != nil {
		t.Fatal(err)
	}
	got := make([]string, len(lines))
	for i, l := range lines {
		got[i] = l.Stream + "|" + l.TS + "|" + l.Text
	}
	want := []string{
		"stdout|2026-11-16T10:00:00.000000001Z|started",
		"stderr|2026-11-16T10:00:02.000000001Z|boom",
		"stdout|2026-11-16T10:00:01.000000001Z|partial line",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("got\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

func TestParseLineCapsLength(t *testing.T) {
	l := parseLine("2026-11-16T10:00:00Z "+strings.Repeat("é", MaxLineBytes), "stdout")
	if len(l.Text) > MaxLineBytes+20 || !strings.HasSuffix(l.Text, "[cut]") {
		t.Fatalf("len %d", len(l.Text))
	}
	if l := parseLine("no timestamp here", "stdout"); l.TS != "" || l.Text != "no timestamp here" {
		t.Fatalf("%+v", l)
	}
}

func TestComputeStats(t *testing.T) {
	var raw rawStats
	raw.CPU.Usage.Total, raw.PreCPU.Usage.Total = 2_000_000, 1_000_000
	raw.CPU.System, raw.PreCPU.System = 20_000_000, 10_000_000
	raw.CPU.Online = 4
	raw.Memory.Usage, raw.Memory.Limit = 100<<20, 128<<20
	raw.Memory.Stats = map[string]uint64{"inactive_file": 20 << 20}
	s := computeStats(raw)
	if s.CPUPercent != 40 {
		t.Errorf("cpu = %v", s.CPUPercent)
	}
	if s.MemBytes != 80<<20 || s.MemLimitBytes != 128<<20 {
		t.Errorf("mem = %d / %d", s.MemBytes, s.MemLimitBytes)
	}
}

func TestRegistryHost(t *testing.T) {
	for in, want := range map[string]string{
		"ghcr.io/o/app": "ghcr.io", "alpine": "docker.io", "library/alpine": "docker.io",
		"localhost/app": "localhost", "registry:5000/app": "registry:5000",
	} {
		if got := registryHost(in); got != want {
			t.Errorf("registryHost(%q) = %q, want %q", in, got, want)
		}
	}
}
