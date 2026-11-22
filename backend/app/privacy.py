"""Privacy gate and PII redaction for PlainMark v2."""

from __future__ import annotations

import re
from collections.abc import Sequence

DEFAULT_VISIBILITY = "local_only"
VALID_VISIBILITIES = {"local_only", "shareable"}
LOCAL_PROVIDERS = {"", "lms", "local", "lmstudio", "lm-studio", "ollama"}
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


def normalize_visibility(value: str | None) -> str:
    cleaned = (value or "").strip().lower()
    if cleaned in VALID_VISIBILITIES:
        return cleaned
    return DEFAULT_VISIBILITY


def is_cloud_provider(provider: str | None) -> bool:
    """Return True if provider sends data outside the local machine."""
    if provider is None:
        return False
    return provider.strip().lower() not in LOCAL_PROVIDERS


def filter_meetings_for_provider(
    meetings: list[dict],
    *,
    provider: str | None,
    allow_local_only: bool = False,
) -> tuple[list[dict], int]:
    """Filter out local_only meetings when targeting a Cloud CLI or MCP."""
    if allow_local_only or not is_cloud_provider(provider):
        return list(meetings), 0
    allowed = [m for m in meetings if m.get("visibility", DEFAULT_VISIBILITY) == "shareable"]
    return allowed, len(meetings) - len(allowed)


def redact_pii(text: str, *, names: Sequence[str] | None = None) -> str:
    """Redact emails and known participant names/nicknames before cloud export."""
    if not text:
        return text
    redacted = EMAIL_RE.sub("[REDACTED_EMAIL]", text)
    if names:
        unique_names = sorted({n.strip() for n in names if n and n.strip()}, key=len, reverse=True)
        for name in unique_names:
            redacted = re.sub(re.escape(name), "[REDACTED_NAME]", redacted, flags=re.IGNORECASE)
    return redacted
