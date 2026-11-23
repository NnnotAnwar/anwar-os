import pytest

from osbot.config import ConfigError, load_config

ENV = {
    "BOT_TOKEN": "123:not-a-real-token",
    "OSBOT_API_URL": "http://web:3000/",
    "OSBOT_API_SECRET": "x" * 32,
    "OSBOT_OWNER_CHAT_ID": "42",
}


def test_loads_and_normalises():
    config = load_config(ENV)
    assert config.api_url == "http://web:3000"
    assert config.owner_chat_id == 42
    assert config.version == "dev"
    assert (config.app_url, config.timezone) == ("https://anwar-os.com", "Europe/Prague")
    assert "not-a-real-token" not in repr(config)
    assert "x" * 32 not in repr(config)


def test_app_url_and_timezone_can_be_set():
    config = load_config({**ENV, "OSBOT_APP_URL": "https://os.example/", "OSBOT_TIMEZONE": "Asia/Almaty"})
    assert (config.app_url, config.timezone) == ("https://os.example", "Asia/Almaty")


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"BOT_TOKEN": ""}, "BOT_TOKEN"),
        ({"OSBOT_API_SECRET": "short"}, "at least 32"),
        ({"OSBOT_OWNER_CHAT_ID": "@anwar"}, "must be a number"),
        ({"OSBOT_TIMEZONE": "Mars/Olympus"}, "unknown time zone"),
    ],
)
def test_refuses_bad_config(change, message):
    with pytest.raises(ConfigError, match=message):
        load_config({**ENV, **change})
