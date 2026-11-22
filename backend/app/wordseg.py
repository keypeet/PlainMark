"""Thai word segmentation for FTS5 with pre-tokenizer URL/email guard and newmm fallback."""

from __future__ import annotations

import re
import threading
from collections.abc import Sequence

PRESERVE_RE = re.compile(
    r"https?://[^\s<>\"')\]]+|[\w.+-]+@[\w-]+\.[\w.-]+",
    re.IGNORECASE,
)
WHITESPACE_RE = re.compile(r"\s+")
THAI_CHAR_RE = re.compile(r"[\u0E00-\u0E7F]")

_LOCK = threading.RLock()
_LATTE_CACHE: dict[tuple[str, tuple[str, ...]], object] = {}
_LATTE_AVAILABLE: bool | None = None


def _normalize_user_words(user_words: Sequence[str] | None) -> tuple[str, ...]:
    if not user_words:
        return ()
    cleaned = {w.strip() for w in user_words if w and w.strip()}
    return tuple(sorted(cleaned))


def _get_latte_segmenter(unit: str, words_key: tuple[str, ...]):
    global _LATTE_AVAILABLE
    with _LOCK:
        if _LATTE_AVAILABLE is False:
            return None
        cache_key = (unit, words_key)
        if cache_key in _LATTE_CACHE:
            return _LATTE_CACHE[cache_key]
        try:
            from openthai_latte_wordseg_lite import Segmenter

            seg = Segmenter(
                unit=unit,
                batch_chars=0,  # Mandatory: prevents 2.9% int8 batch mismatch between index & query
                user_words=list(words_key) if words_key else None,
            )
            _LATTE_AVAILABLE = True
            _LATTE_CACHE[cache_key] = seg
            return seg
        except Exception:
            _LATTE_AVAILABLE = False
            return None


def active_engine() -> str:
    """Return the active segmentation engine name ('latte' or 'newmm')."""
    if _get_latte_segmenter("short", ()) is not None:
        return "latte"
    return "newmm"


def _tokenize_with_newmm(text: str, words_key: tuple[str, ...]) -> list[str]:
    from pythainlp.tokenize import word_tokenize
    from pythainlp.util import dict_trie

    if words_key:
        from pythainlp.corpus import thai_words

        trie = dict_trie(dict_source=set(thai_words()) | set(words_key))
        return [t for t in word_tokenize(text, custom_dict=trie, engine="newmm") if t.strip()]
    return [t for t in word_tokenize(text, engine="newmm") if t.strip()]


def _tokenize_chunk(chunk: str, words_key: tuple[str, ...], engine: str) -> list[str]:
    stripped = chunk.strip()
    if not stripped:
        return []
    if not THAI_CHAR_RE.search(stripped):
        return [tok for tok in WHITESPACE_RE.split(stripped) if tok]

    if engine in {"auto", "latte"}:
        seg = _get_latte_segmenter("short", words_key)
        if seg is not None:
            try:
                tokens = seg.tokenize(stripped)
                return [t.strip() for t in tokens if t and t.strip()]
            except Exception:
                if engine == "latte":
                    raise
    return _tokenize_with_newmm(stripped, words_key)


def tokenize_text(
    text: str,
    user_words: Sequence[str] | None = None,
    *,
    engine: str = "auto",
) -> list[str]:
    """Tokenize text while preserving URLs and emails intact."""
    if not text or not text.strip():
        return []

    words_key = _normalize_user_words(user_words)
    tokens: list[str] = []
    last_end = 0

    for match in PRESERVE_RE.finditer(text):
        start, end = match.span()
        if start > last_end:
            tokens.extend(_tokenize_chunk(text[last_end:start], words_key, engine))
        preserved = match.group(0).rstrip(".,;:!?)")
        if preserved:
            tokens.append(preserved)
        last_end = end

    if last_end < len(text):
        tokens.extend(_tokenize_chunk(text[last_end:], words_key, engine))

    return tokens


def segment_for_fts(
    text: str,
    user_words: Sequence[str] | None = None,
    *,
    engine: str = "auto",
) -> str:
    """Return space-delimited tokens suitable for SQLite FTS5 indexing."""
    return " ".join(tokenize_text(text, user_words=user_words, engine=engine))


def tokenize_query(
    query: str,
    user_words: Sequence[str] | None = None,
    *,
    engine: str = "auto",
) -> list[str]:
    """Tokenize search query consistently with segment_for_fts (batch_chars=0)."""
    return tokenize_text(query, user_words=user_words, engine=engine)
