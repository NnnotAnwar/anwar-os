import pytest

from expenses_bot.money import (
    Entry,
    format_amount,
    format_number,
    parse_amount,
    parse_entry,
)

NB = "\u00a0"


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


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("250", Entry(25000, None)),
        ("250 coffee", Entry(25000, "coffee")),
        ("15,50 food lunch", Entry(1550, "food lunch")),
        ("250kč coffee", Entry(25000, "coffee")),
        ("250 Kč", Entry(25000, None)),
        ("250,- tram", Entry(25000, "tram")),
        ("coffee 250", Entry(25000, "coffee")),
        ("lunch with Eva 320.5 czk", Entry(32050, "lunch with Eva")),
        ("  250   coffee\nbeans ", Entry(25000, "coffee beans")),
        ("250 kcal bar", Entry(25000, "kcal bar")),
    ],
)
def test_parse_entry(text, expected):
    assert parse_entry(text) == expected


@pytest.mark.parametrize("text", [None, "", "coffee", "0 coffee", "-5 coffee", "hello world", "15.555 x"])
def test_parse_entry_rejects(text):
    assert parse_entry(text) is None


def test_parse_entry_caps_note_length():
    entry = parse_entry("10 " + "x" * 500)
    assert entry is not None and len(entry.text) == 200


def test_format_amount():
    assert format_amount(1550, "CZK") == f"15.50{NB}CZK"
    assert format_amount(25000, "CZK") == f"250{NB}CZK"
    assert format_amount(125000, "CZK") == f"1{NB}250{NB}CZK"
    assert format_amount(5, "EUR") == f"0.05{NB}EUR"
    assert format_amount(-1550, "CZK") == f"-15.50{NB}CZK"


def test_format_number_whole_only_rounds_half_up():
    assert format_number(123450, whole_only=True) == f"1{NB}235"
    assert format_number(123449, whole_only=True) == f"1{NB}234"
    assert format_number(100000000, whole_only=True) == f"1{NB}000{NB}000"
