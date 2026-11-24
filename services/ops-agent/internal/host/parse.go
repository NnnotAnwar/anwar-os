package host

import (
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
)

// ParseUptime reads /proc/uptime ("12345.67 54321.00"): seconds since boot.
func ParseUptime(raw string) (float64, error) {
	f := strings.Fields(raw)
	if len(f) == 0 {
		return 0, errors.New("empty /proc/uptime")
	}
	return strconv.ParseFloat(f[0], 64)
}

// ParseLoadavg reads /proc/loadavg ("0.10 0.20 0.30 1/234 5678").
func ParseLoadavg(raw string) ([3]float64, error) {
	var out [3]float64
	f := strings.Fields(raw)
	if len(f) < 3 {
		return out, fmt.Errorf("unexpected /proc/loadavg: %q", raw)
	}
	for i := range out {
		v, err := strconv.ParseFloat(f[i], 64)
		if err != nil {
			return out, err
		}
		out[i] = v
	}
	return out, nil
}

// ParseMeminfo reads /proc/meminfo ("MemTotal:  3884000 kB" lines).
func ParseMeminfo(raw string) (*Memory, error) {
	kb := map[string]uint64{}
	for _, line := range strings.Split(raw, "\n") {
		key, rest, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		f := strings.Fields(rest)
		if len(f) == 0 {
			continue
		}
		v, err := strconv.ParseUint(f[0], 10, 64)
		if err != nil {
			continue
		}
		kb[strings.TrimSpace(key)] = v
	}
	total, ok := kb["MemTotal"]
	if !ok || total == 0 {
		return nil, errors.New("no MemTotal in /proc/meminfo")
	}
	avail, ok := kb["MemAvailable"]
	if !ok { // kernels before 3.14; never on the server, but don't lie
		avail = kb["MemFree"] + kb["Buffers"] + kb["Cached"]
	}
	avail = min(avail, total)
	swapUsed := uint64(0)
	if kb["SwapTotal"] > kb["SwapFree"] {
		swapUsed = kb["SwapTotal"] - kb["SwapFree"]
	}
	return &Memory{
		TotalBytes:     total * 1024,
		AvailableBytes: avail * 1024,
		UsedBytes:      (total - avail) * 1024,
		SwapTotalBytes: kb["SwapTotal"] * 1024,
		SwapUsedBytes:  swapUsed * 1024,
	}, nil
}

// ParsePressure reads /proc/pressure/memory:
//
//	some avg10=0.00 avg60=1.25 avg300=0.40 total=123
//	full avg10=0.00 avg60=0.10 avg300=0.02 total=45
func ParsePressure(raw string) (some, full *float64) {
	for _, line := range strings.Split(raw, "\n") {
		f := strings.Fields(line)
		if len(f) < 2 {
			continue
		}
		for _, kv := range f[1:] {
			k, v, ok := strings.Cut(kv, "=")
			if !ok || k != "avg60" {
				continue
			}
			n, err := strconv.ParseFloat(v, 64)
			if err != nil {
				continue
			}
			switch f[0] {
			case "some":
				some = &n
			case "full":
				full = &n
			}
		}
	}
	return some, full
}

// ParseSites returns the HTTPS hostnames a Caddyfile serves: the addresses in
// front of every top-level block. Snippets "(name)", the global options block,
// http:// addresses, IPs, wildcards, ports other than 443 and placeholders
// are skipped; a ":443" or "https://" prefix is stripped.
func ParseSites(caddyfile string) []string {
	var out []string
	depth := 0
	for _, line := range strings.Split(caddyfile, "\n") {
		line = stripComment(line)
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		if depth == 0 && strings.HasSuffix(trimmed, "{") {
			head := strings.TrimSpace(strings.TrimSuffix(trimmed, "{"))
			if head != "" && !strings.HasPrefix(head, "(") {
				for _, addr := range strings.FieldsFunc(head, func(r rune) bool { return r == ',' || r == ' ' || r == '\t' }) {
					if host, ok := siteHost(addr); ok {
						out = append(out, host)
					}
				}
			}
		}
		depth += strings.Count(line, "{") - strings.Count(line, "}")
		if depth < 0 {
			depth = 0
		}
	}
	return out
}

func stripComment(line string) string {
	// A '#' starts a comment at the line start or after whitespace.
	for i := 0; i < len(line); i++ {
		if line[i] == '#' && (i == 0 || line[i-1] == ' ' || line[i-1] == '\t') {
			return line[:i]
		}
	}
	return line
}

func siteHost(addr string) (string, bool) {
	addr = strings.TrimSpace(addr)
	if strings.HasPrefix(addr, "http://") || strings.ContainsAny(addr, "{}$*") {
		return "", false
	}
	addr = strings.TrimPrefix(addr, "https://")
	if i := strings.IndexByte(addr, '/'); i >= 0 {
		addr = addr[:i]
	}
	if h, p, err := net.SplitHostPort(addr); err == nil {
		if p != "443" {
			return "", false
		}
		addr = h
	}
	addr = strings.ToLower(strings.TrimSuffix(addr, "."))
	if addr == "" || addr == "localhost" || net.ParseIP(addr) != nil || !strings.Contains(addr, ".") {
		return "", false
	}
	for _, r := range addr {
		if !(r == '-' || r == '.' || (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')) {
			return "", false
		}
	}
	return addr, true
}
