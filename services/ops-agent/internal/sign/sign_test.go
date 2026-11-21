package sign

import (
	"errors"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

var secret = []byte("test-secret-0123456789abcdef0123456789abcdef")

// Shared with src/modules/ops/lib/sign.test.ts: both sides must produce this.
const (
	vectorTS        = int64(1763290000)
	vectorNonce     = "n0nce-AAAAAAAAAAAAAAAA"
	vectorMethod    = "POST"
	vectorPath      = "/services/bot-expenses/deploy"
	vectorBody      = `{"tag":"abc1234"}`
	vectorSignature = "v1=45630aa8395de1909629504bfe6e4df7fa4b48c0789afec9e2b8a3d80b3e311d"
)

func TestSignMatchesSharedVector(t *testing.T) {
	got := Sign(secret, vectorTS, vectorNonce, vectorMethod, vectorPath, []byte(vectorBody))
	if got != vectorSignature {
		t.Fatalf("signature = %s, want %s", got, vectorSignature)
	}
}

type req struct {
	method, path, body string
	ts                 int64
	nonce              string
	sig                string // empty = sign correctly
}

func verify(t *testing.T, v *Verifier, r req) error {
	t.Helper()
	hr := httptest.NewRequest(r.method, r.path, strings.NewReader(r.body))
	hr.Header.Set(HeaderTimestamp, strconv.FormatInt(r.ts, 10))
	hr.Header.Set(HeaderNonce, r.nonce)
	sig := r.sig
	if sig == "" {
		sig = Sign(secret, r.ts, r.nonce, r.method, r.path, []byte(r.body))
	}
	hr.Header.Set(HeaderSignature, sig)
	return v.Verify(hr, []byte(r.body))
}

func fixedClock(t time.Time) func() time.Time { return func() time.Time { return t } }

func TestVerify(t *testing.T) {
	now := time.Unix(vectorTS, 0)
	base := req{method: "POST", path: "/services/bot-expenses/restart", body: "{}", ts: vectorTS, nonce: "abcdefghijklmnop0001"}

	t.Run("accepts a correctly signed request", func(t *testing.T) {
		v := NewVerifier(secret).WithClock(fixedClock(now))
		if err := verify(t, v, base); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("accepts clock skew up to the window in both directions", func(t *testing.T) {
		for i, skew := range []time.Duration{59 * time.Second, -59 * time.Second} {
			v := NewVerifier(secret).WithClock(fixedClock(now.Add(skew)))
			r := base
			r.nonce = "skewnonce000000000" + strconv.Itoa(i)
			if err := verify(t, v, r); err != nil {
				t.Fatalf("skew %v: %v", skew, err)
			}
		}
	})

	t.Run("refuses stale and future timestamps", func(t *testing.T) {
		for _, skew := range []time.Duration{61 * time.Second, -61 * time.Second, time.Hour} {
			v := NewVerifier(secret).WithClock(fixedClock(now.Add(skew)))
			if err := verify(t, v, base); !errors.Is(err, ErrExpired) {
				t.Fatalf("skew %v: err = %v, want ErrExpired", skew, err)
			}
		}
	})

	t.Run("refuses a replayed nonce", func(t *testing.T) {
		v := NewVerifier(secret).WithClock(fixedClock(now))
		if err := verify(t, v, base); err != nil {
			t.Fatal(err)
		}
		if err := verify(t, v, base); !errors.Is(err, ErrReplay) {
			t.Fatalf("err = %v, want ErrReplay", err)
		}
	})

	t.Run("forgets nonces once they can no longer pass the window", func(t *testing.T) {
		clock := now
		v := NewVerifier(secret).WithClock(func() time.Time { return clock })
		if err := verify(t, v, base); err != nil {
			t.Fatal(err)
		}
		clock = now.Add(2 * Window)
		r := base
		r.ts = clock.Unix()
		r.nonce = "abcdefghijklmnop0002"
		if err := verify(t, v, r); err != nil {
			t.Fatal(err)
		}
		if _, ok := v.seen[base.nonce]; ok {
			t.Fatal("expired nonce still cached")
		}
	})

	t.Run("binds the signature to method, path, query and body", func(t *testing.T) {
		good := Sign(secret, base.ts, base.nonce, base.method, base.path, []byte(base.body))
		cases := map[string]req{
			"method": {method: "DELETE", path: base.path, body: base.body},
			"path":   {method: base.method, path: "/services/web/restart", body: base.body},
			"query":  {method: base.method, path: base.path + "?x=1", body: base.body},
			"body":   {method: base.method, path: base.path, body: `{"tag":"evil"}`},
		}
		for name, r := range cases {
			v := NewVerifier(secret).WithClock(fixedClock(now))
			r.ts, r.nonce, r.sig = base.ts, base.nonce, good
			if err := verify(t, v, r); !errors.Is(err, ErrBadSignature) {
				t.Fatalf("%s: err = %v, want ErrBadSignature", name, err)
			}
		}
	})

	t.Run("refuses a signature made with another secret", func(t *testing.T) {
		v := NewVerifier([]byte("another-secret-entirely-000000000000")).WithClock(fixedClock(now))
		if err := verify(t, v, base); !errors.Is(err, ErrBadSignature) {
			t.Fatalf("err = %v", err)
		}
	})

	t.Run("refuses missing and malformed headers", func(t *testing.T) {
		v := NewVerifier(secret).WithClock(fixedClock(now))
		hr := httptest.NewRequest("GET", "/services", nil)
		if err := v.Verify(hr, nil); !errors.Is(err, ErrMissing) {
			t.Fatalf("no headers: %v", err)
		}
		bad := []req{
			{method: "GET", path: "/services", ts: vectorTS, nonce: "short", sig: ""},
			{method: "GET", path: "/services", ts: vectorTS, nonce: "has spaces in it......", sig: ""},
			{method: "GET", path: "/services", ts: vectorTS, nonce: "abcdefghijklmnop0003", sig: "v2=00"},
			{method: "GET", path: "/services", ts: vectorTS, nonce: "abcdefghijklmnop0004", sig: "v1=zz"},
			{method: "GET", path: "/services", ts: vectorTS, nonce: "abcdefghijklmnop0005", sig: "v1=abcd"},
		}
		for i, r := range bad {
			if err := verify(t, v, r); !errors.Is(err, ErrMalformed) {
				t.Fatalf("case %d: err = %v, want ErrMalformed", i, err)
			}
		}
		hr = httptest.NewRequest("GET", "/services", nil)
		hr.Header.Set(HeaderTimestamp, "yesterday")
		hr.Header.Set(HeaderNonce, "abcdefghijklmnop0006")
		hr.Header.Set(HeaderSignature, "v1="+strings.Repeat("0", 64))
		if err := v.Verify(hr, nil); !errors.Is(err, ErrMalformed) {
			t.Fatalf("bad timestamp: %v", err)
		}
	})
}
