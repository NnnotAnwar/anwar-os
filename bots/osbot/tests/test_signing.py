from osbot import signing

SECRET = "test-secret-0123456789abcdef0123456789abcdef"
BODY = '{"kind":"note","text":"Buy milk ✓"}'


def test_shared_vector_matches_the_web_app():
    # Same vector as src/modules/osbot/signature.test.ts.
    assert (
        signing.sign(SECRET, "1794830400", "abcdef0123456789abcdef", "POST", "/api/internal/osbot/capture", BODY)
        == "c61401fbc027c286fbae5844b1862ffaf51c622fc43150d3e44d3ede3bdc469e"
    )


def test_signed_headers_verify_and_tampering_fails():
    headers = signing.signed_headers(SECRET, "GET", "/api/internal/osbot/today", "", timestamp=1_794_830_400)
    assert signing.verify(SECRET, headers, "GET", "/api/internal/osbot/today", "", now=1_794_830_430)
    assert not signing.verify(SECRET, headers, "GET", "/api/internal/osbot/feedback/new", "", now=1_794_830_430)
    assert not signing.verify(SECRET, headers, "POST", "/api/internal/osbot/today", "", now=1_794_830_430)
    assert not signing.verify(SECRET + "x", headers, "GET", "/api/internal/osbot/today", "", now=1_794_830_430)
    assert not signing.verify(SECRET, headers, "GET", "/api/internal/osbot/today", "", now=1_794_830_461)


def test_nonces_are_fresh_and_url_safe():
    a = signing.signed_headers(SECRET, "GET", "/x", "")[signing.HEADER_NONCE]
    b = signing.signed_headers(SECRET, "GET", "/x", "")[signing.HEADER_NONCE]
    assert a != b
    assert 16 <= len(a) <= 64 and all(c.isalnum() or c in "-_" for c in a)
