package docker

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// MaxLineBytes caps one log line; longer lines are cut and marked.
const MaxLineBytes = 4096

type LogLine struct {
	TS     string `json:"ts"`
	Stream string `json:"stream"` // stdout | stderr
	Text   string `json:"text"`
}

// Logs returns the last `tail` lines with timestamps, oldest first.
func (c *Client) Logs(ctx context.Context, id string, tail int, tty bool) ([]LogLine, error) {
	q := url.Values{
		"stdout":     {"1"},
		"stderr":     {"1"},
		"timestamps": {"1"},
		"tail":       {strconv.Itoa(tail)},
	}
	res, err := c.do(ctx, http.MethodGet, "/containers/"+url.PathEscape(id)+"/logs", q, nil, nil)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	body := io.LimitReader(res.Body, 8<<20)
	if tty {
		return splitLines(body, "stdout")
	}
	return demux(body)
}

// demux reads Docker's multiplexed stream: frames of an 8-byte header
// [stream, 0, 0, 0, size uint32 BE] followed by size bytes of payload.
func demux(r io.Reader) ([]LogLine, error) {
	var out []LogLine
	partial := map[string]*bytes.Buffer{"stdout": {}, "stderr": {}}
	hdr := make([]byte, 8)
	for {
		if _, err := io.ReadFull(r, hdr); err != nil {
			if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
				break
			}
			return out, err
		}
		stream := "stdout"
		if hdr[0] == 2 {
			stream = "stderr"
		}
		size := binary.BigEndian.Uint32(hdr[4:])
		payload := make([]byte, size)
		if _, err := io.ReadFull(r, payload); err != nil {
			break
		}
		buf := partial[stream]
		buf.Write(payload)
		for {
			line, err := buf.ReadBytes('\n')
			if err != nil { // no newline yet: keep the rest for the next frame
				rest := append([]byte(nil), line...)
				buf.Reset()
				buf.Write(rest)
				break
			}
			out = append(out, parseLine(string(line[:len(line)-1]), stream))
		}
	}
	for stream, buf := range partial {
		if buf.Len() > 0 {
			out = append(out, parseLine(buf.String(), stream))
		}
	}
	return out, nil
}

func splitLines(r io.Reader, stream string) ([]LogLine, error) {
	var out []LogLine
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64<<10), 1<<20)
	for sc.Scan() {
		out = append(out, parseLine(sc.Text(), stream))
	}
	return out, sc.Err()
}

// parseLine splits "<RFC3339Nano> text" (timestamps=1) and caps the length.
func parseLine(s, stream string) LogLine {
	s = strings.TrimRight(s, "\r")
	ts, text, ok := strings.Cut(s, " ")
	if !ok || len(ts) < 20 || ts[4] != '-' {
		ts, text = "", s
	}
	if len(text) > MaxLineBytes {
		text = strings.ToValidUTF8(text[:MaxLineBytes], "") + " …[cut]"
	}
	return LogLine{TS: ts, Stream: stream, Text: text}
}

func encodeAuth(raw []byte) string { return base64.URLEncoding.EncodeToString(raw) }
