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
    assert "not-a-real-token" not in repr(config)
    assert "x" * 32 not in repr(config)


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"BOT_TOKEN": ""}, "BOT_TOKEN"),
        ({"OSBOT_API_SECRET": "short"}, "at least 32"),
        ({"OSBOT_OWNER_CHAT_ID": "@anwar"}, "must be a number"),
    ],
)
def test_refuses_bad_config(change, message):
    with pytest.raises(ConfigError, match=message):
        load_config({**ENV, **change})
