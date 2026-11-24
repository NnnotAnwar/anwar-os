package docker

import (
	"encoding/json"
	"testing"
)

func TestSumDiskUsage(t *testing.T) {
	// Trimmed GET /system/df answer (Engine API 1.47).
	raw := `{
	  "LayersSize": 1000,
	  "Images": [{"Containers": 2}, {"Containers": 0}, {"Containers": 1}],
	  "Containers": [{"SizeRw": 10}, {"SizeRw": 0}, {"SizeRw": 5}],
	  "Volumes": [{"UsageData": {"Size": 300, "RefCount": 1}}, {"UsageData": {"Size": -1, "RefCount": 0}}, {}],
	  "BuildCache": [{"Size": 40, "Shared": false}, {"Size": 60, "Shared": true}]
	}`
	var in rawDiskUsage
	if err := json.Unmarshal([]byte(raw), &in); err != nil {
		t.Fatal(err)
	}
	got := sumDiskUsage(in)
	want := DiskUsage{
		ImagesBytes: 1000, Images: 3, UnusedImages: 1,
		ContainersBytes: 15, Containers: 3,
		VolumesBytes: 300, Volumes: 3,
		BuildCacheBytes: 40,
		TotalBytes:      1355,
	}
	if *got != want {
		t.Fatalf("got %+v\nwant %+v", *got, want)
	}
}
