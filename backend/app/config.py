"""Runtime paths and configuration for PlainMark v2."""

from __future__ import annotations

import os
from pathlib import Path

DEFAULT_PORT = 4985


def default_data_root() -> Path:
    """Default workspace data folder outside OneDrive (C:\\Users\\<user>\\PlainMarkData)."""
    env_dir = os.environ.get("PLAINMARK_DATA_DIR", "").strip()
    if env_dir:
        return Path(env_dir).expanduser().resolve()
    return (Path.home() / "PlainMarkData").resolve()


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def dist_dir() -> Path:
    return repo_root() / "dist"


def server_port() -> int:
    raw = os.environ.get("PLAINMARK_PORT", str(DEFAULT_PORT)).strip()
    try:
        port = int(raw)
        if 1024 <= port <= 65535:
            return port
    except ValueError:
        pass
    return DEFAULT_PORT
