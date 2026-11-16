// Package sign authenticates requests from web to ops-agent.
//
// Every request carries three headers:
//
//	X-OS-Timestamp  unix seconds when web signed it
//	X-OS-Nonce      16–128 random URL-safe characters, never reused
//	X-OS-Signature  "v1=" + hex(HMAC-SHA256(secret, payload))
//
// payload = "v1\n" + timestamp + "\n" + nonce + "\n" + METHOD + "\n" +
// path-with-query + "\n" + hex(SHA-256(body))
//
// The signature covers the method, the exact path and the body, so a captured
// request can't be pointed at another service or action. Requests older or newer
// than Window are refused, and a nonce is accepted once, which stops replays
// inside the window. src/modules/ops/lib/sign.ts is the web side; both share the
// test vector in sign_test.go / sign.test.ts.
package sign

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	HeaderTimestamp = "X-OS-Timestamp"
	HeaderNonce     = "X-OS-Nonce"
	HeaderSignature = "X-OS-Signature"

	// Window is how far a request's timestamp may be from the agent's clock.
	Window = 60 * time.Second

	version = "v1"
)

var (
	ErrMissing      = errors.New("missing signature headers")
	ErrMalformed    = errors.New("malformed signature headers")
	ErrExpired      = errors.New("timestamp outside the allowed window")
	ErrBadSignature = errors.New("signature does not match")
	ErrReplay       = errors.New("nonce already used")
)

var nonceRe = regexp.MustCompile(`^[A-Za-z0-9_-]{16,128}$`)

// Payload is the exact byte string that gets signed.
func Payload(ts int64, nonce, method, pathQuery string, body []byte) []byte {
	sum := sha256.Sum256(body)
	var b strings.Builder
	b.WriteString(version)
	b.WriteByte('\n')
	b.WriteString(strconv.FormatInt(ts, 10))
	b.WriteByte('\n')
	b.WriteString(nonce)
	b.WriteByte('\n')
	b.WriteString(strings.ToUpper(method))
	b.WriteByte('\n')
	b.WriteString(pathQuery)
	b.WriteByte('\n')
	b.WriteString(hex.EncodeToString(sum[:]))
	return []byte(b.String())
}

func mac(secret []byte, payload []byte) []byte {
	m := hmac.New(sha256.New, secret)
	m.Write(payload)
	return m.Sum(nil)
}

// Sign returns the X-OS-Signature header value.
func Sign(secret []byte, ts int64, nonce, method, pathQuery string, body []byte) string {
	return version + "=" + hex.EncodeToString(mac(secret, Payload(ts, nonce, method, pathQuery, body)))
}

// Verifier checks signatures and remembers nonces it has accepted.
type Verifier struct {
	secret []byte
	now    func() time.Time

	mu   sync.Mutex
	seen map[string]time.Time // nonce -> when it may be forgotten
}

func NewVerifier(secret []byte) *Verifier {
	return &Verifier{secret: secret, now: time.Now, seen: map[string]time.Time{}}
}

// WithClock replaces the clock (tests).
func (v *Verifier) WithClock(now func() time.Time) *Verifier {
	v.now = now
	return v
}

// Verify authenticates r, whose body has already been read into body.
func (v *Verifier) Verify(r *http.Request, body []byte) error {
	tsRaw := r.Header.Get(HeaderTimestamp)
	nonce := r.Header.Get(HeaderNonce)
	sigRaw := r.Header.Get(HeaderSignature)
	if tsRaw == "" || nonce == "" || sigRaw == "" {
		return ErrMissing
	}
	ts, err := strconv.ParseInt(tsRaw, 10, 64)
	if err != nil || ts <= 0 {
		return ErrMalformed
	}
	if !nonceRe.MatchString(nonce) {
		return ErrMalformed
	}
	hexSig, ok := strings.CutPrefix(sigRaw, version+"=")
	if !ok {
		return ErrMalformed
	}
	got, err := hex.DecodeString(hexSig)
	if err != nil || len(got) != sha256.Size {
		return ErrMalformed
	}

	now := v.now()
	signedAt := time.Unix(ts, 0)
	if d := now.Sub(signedAt); d > Window || d < -Window {
		return ErrExpired
	}

	want := mac(v.secret, Payload(ts, nonce, r.Method, r.URL.RequestURI(), body))
	if !hmac.Equal(want, got) {
		return ErrBadSignature
	}

	// Only authentic requests reach the nonce cache, so its size is bounded by
	// real traffic. A nonce can be forgotten once its timestamp leaves the window.
	v.mu.Lock()
	defer v.mu.Unlock()
	for n, until := range v.seen {
		if now.After(until) {
			delete(v.seen, n)
		}
	}
	if _, used := v.seen[nonce]; used {
		return ErrReplay
	}
	v.seen[nonce] = signedAt.Add(Window + time.Second)
	return nil
}
