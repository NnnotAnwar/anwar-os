//go:build !linux && !darwin

package host

import "errors"

func statDisk(string) (*Disk, error) { return nil, errors.New("statfs not supported on this platform") }
