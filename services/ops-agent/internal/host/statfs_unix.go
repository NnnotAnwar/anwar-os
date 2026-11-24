//go:build linux || darwin

package host

import "syscall"

// statDisk is `df` for the filesystem holding path.
func statDisk(path string) (*Disk, error) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return nil, err
	}
	bsize := uint64(st.Bsize)
	total := st.Blocks * bsize
	free := st.Bfree * bsize
	avail := st.Bavail * bsize
	used := total - free
	d := &Disk{Path: path, TotalBytes: total, UsedBytes: used, AvailableBytes: avail}
	if used+avail > 0 {
		d.UsedPercent = round1(float64(used) / float64(used+avail) * 100)
	}
	return d, nil
}
