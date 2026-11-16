import pytest

from expenses_bot.money import format_amount, parse_amount


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("50", 5000),
        ("15.50", 1550),
        ("15,5", 1550),
        (" 15.5 ", 1550),
        ("0.01", 1),
        ("999999999.99", 99999999999),
    ],
)
def test_parse_amount_valid(text, expected):
    assert parse_amount(text) == expected


@pytest.mark.parametrize(
    "text",
    [None, "", "0", "0.00", "-5", "abc", "nan", "inf", "1e3", "15.555", "1 500", "+5", "1234567890"],
)
def test_parse_amount_invalid(text):
    # The old bot used float(): "nan" and "inf" passed its `amount <= 0` check.
    assert parse_amount(text) is None


def test_format_amount():
    assert format_amount(1550, "CZK") == "15.50 CZK"
    assert format_amount(5, "EUR") == "0.05 EUR"
    assert format_amount(-1550, "CZK") == "-15.50 CZK"
