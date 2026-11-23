from expenses_bot import signing

SECRET = "test-secret-0123456789abcdef0123456789abcdef"
BODY = '{"text":"250 food lunch ✓"}'
PATH = "/api/internal/budget-bot/expenses/quick"


def test_shared_vector_matches_the_web_app():
    # Same vector as src/modules/budget/bot-api/lib.test.ts.
    assert (
        signing.sign(SECRET, "1794830400", "abcdef0123456789abcdef", "POST", PATH, BODY)
        == "fde551cc4398412fb49928d0a96a9de3aaafa0aebdec48b0dd3e260e94a336f4"
    )


def test_headers_are_the_budget_bots_own():
    headers = signing.signed_headers(SECRET, "GET", "/x", "", timestamp=1_794_830_400)
    assert sorted(headers) == ["x-budget-bot-nonce", "x-budget-bot-signature", "x-budget-bot-timestamp"]


def test_signed_headers_verify_and_tampering_fails():
    path = "/api/internal/budget-bot/setup"
    headers = signing.signed_headers(SECRET, "GET", path, "", timestamp=1_794_830_400)
    assert signing.verify(SECRET, headers, "GET", path, "", now=1_794_830_430)
    assert not signing.verify(SECRET, headers, "GET", "/api/internal/budget-bot/expenses/recent", "", now=1_794_830_430)
    assert not signing.verify(SECRET, headers, "POST", path, "", now=1_794_830_430)
    assert not signing.verify(SECRET + "x", headers, "GET", path, "", now=1_794_830_430)
    assert not signing.verify(SECRET, headers, "GET", path, "", now=1_794_830_461)


def test_nonces_are_fresh_and_url_safe():
    a = signing.signed_headers(SECRET, "GET", "/x", "")[signing.HEADER_NONCE]
    b = signing.signed_headers(SECRET, "GET", "/x", "")[signing.HEADER_NONCE]
    assert a != b
    assert 16 <= len(a) <= 64 and all(c.isalnum() or c in "-_" for c in a)
