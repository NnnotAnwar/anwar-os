package docker

import (
	"context"
	"net/http"
)

// ---------------------------------------------------------------------------
// System: what the host panel (GET /host) needs from the daemon.
// ---------------------------------------------------------------------------

// Info is the part of GET /info the host panel shows. The daemon runs on the
// host, so these describe the server, not the agent's container.
type Info struct {
	Name            string `json:"Name"` // the host's hostname
	OperatingSystem string `json:"OperatingSystem"`
	KernelVersion   string `json:"KernelVersion"`
	Architecture    string `json:"Architecture"`
	NCPU            int    `json:"NCPU"`
	MemTotal        int64  `json:"MemTotal"`
	ServerVersion   string `json:"ServerVersion"`
	DockerRootDir   string `json:"DockerRootDir"`
}

func (c *Client) Info(ctx context.Context) (*Info, error) {
	var out Info
	if err := c.call(ctx, http.MethodGet, "/info", nil, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// DiskUsage is `docker system df`, summed per kind.
type DiskUsage struct {
	ImagesBytes     int64 `json:"images_bytes"`
	Images          int   `json:"images"`
	UnusedImages    int   `json:"unused_images"`
	ContainersBytes int64 `json:"containers_bytes"`
	Containers      int   `json:"containers"`
	VolumesBytes    int64 `json:"volumes_bytes"`
	Volumes         int   `json:"volumes"`
	BuildCacheBytes int64 `json:"build_cache_bytes"`
	TotalBytes      int64 `json:"total_bytes"`
}

type rawDiskUsage struct {
	LayersSize int64 `json:"LayersSize"`
	Images     []struct {
		Containers int64 `json:"Containers"`
	} `json:"Images"`
	Containers []struct {
		SizeRw int64 `json:"SizeRw"`
	} `json:"Containers"`
	Volumes []struct {
		UsageData *struct {
			Size int64 `json:"Size"`
		} `json:"UsageData"`
	} `json:"Volumes"`
	BuildCache []struct {
		Size   int64 `json:"Size"`
		Shared bool  `json:"Shared"`
	} `json:"BuildCache"`
}

// DiskUsage walks images, containers, volumes and the build cache: it can take
// a few seconds on a busy host, so callers cache it.
func (c *Client) DiskUsage(ctx context.Context) (*DiskUsage, error) {
	var raw rawDiskUsage
	if err := c.call(ctx, http.MethodGet, "/system/df", nil, nil, &raw); err != nil {
		return nil, err
	}
	return sumDiskUsage(raw), nil
}

func sumDiskUsage(raw rawDiskUsage) *DiskUsage {
	d := &DiskUsage{ImagesBytes: raw.LayersSize, Images: len(raw.Images), Containers: len(raw.Containers), Volumes: len(raw.Volumes)}
	for _, im := range raw.Images {
		if im.Containers == 0 {
			d.UnusedImages++
		}
	}
	for _, c := range raw.Containers {
		if c.SizeRw > 0 {
			d.ContainersBytes += c.SizeRw
		}
	}
	for _, v := range raw.Volumes {
		if v.UsageData != nil && v.UsageData.Size > 0 { // -1 = not computed
			d.VolumesBytes += v.UsageData.Size
		}
	}
	for _, b := range raw.BuildCache {
		if !b.Shared && b.Size > 0 {
			d.BuildCacheBytes += b.Size
		}
	}
	d.TotalBytes = d.ImagesBytes + d.ContainersBytes + d.VolumesBytes + d.BuildCacheBytes
	return d
}
