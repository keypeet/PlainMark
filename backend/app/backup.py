"""Nightly Source-of-Truth backup with daily/weekly rotation."""

from __future__ import annotations

import argparse
import os
import shutil
from datetime import datetime
from pathlib import Path

SKIP_EXTS = {".mp4", ".mkv", ".wav", ".mov", ".avi", ".m4a", ".mp3", ".flac", ".webm"}
SKIP_PREFIXES = ("plainmark.sqlite",)


def _should_skip_file(path: Path) -> bool:
    name_lower = path.name.lower()
    if any(name_lower.startswith(prefix) for prefix in SKIP_PREFIXES):
        return True
    if path.suffix.lower() in SKIP_EXTS:
        return True
    return False


def _copy_tree_filtered(src_root: Path, dest_dir: Path) -> tuple[int, int]:
    backed_up = 0
    skipped = 0
    if dest_dir.exists():
        shutil.rmtree(dest_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)

    for dirpath, _dirnames, filenames in os.walk(src_root):
        current_dir = Path(dirpath)
        rel_dir = current_dir.relative_to(src_root)
        for fname in filenames:
            src_file = current_dir / fname
            if _should_skip_file(src_file):
                skipped += 1
                continue
            target_file = dest_dir / rel_dir / fname
            target_file.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src_file, target_file)
            backed_up += 1
    return backed_up, skipped


def _prune_old_dirs(parent: Path, keep: int) -> int:
    if not parent.is_dir() or keep < 0:
        return 0
    dirs = sorted((d for d in parent.iterdir() if d.is_dir()), key=lambda p: p.name)
    if len(dirs) <= keep:
        return 0
    to_remove = dirs[: len(dirs) - keep]
    for old_dir in to_remove:
        shutil.rmtree(old_dir)
    return len(to_remove)


def run_backup(
    data_root: Path,
    destination_root: Path,
    *,
    keep_daily: int = 7,
    keep_weekly: int = 4,
    now: datetime | None = None,
) -> dict:
    """Back up Source-of-Truth files to destination_root with daily/weekly rotation."""
    src = data_root.resolve()
    dest = destination_root.resolve()
    if not src.is_dir():
        raise FileNotFoundError(f"Data root not found: {src}")
    try:
        dest.relative_to(src)
        raise ValueError("Backup destination must not be inside data root")
    except ValueError as exc:
        if "inside data root" in str(exc):
            raise

    ts = now or datetime.now()
    day_label = ts.strftime("%Y-%m-%d")
    iso_year, iso_week, iso_weekday = ts.isocalendar()
    week_label = f"{iso_year}-W{iso_week:02d}"

    daily_dir = dest / "daily" / day_label
    backed_up, skipped = _copy_tree_filtered(src, daily_dir)

    weekly_root = dest / "weekly"
    weekly_dir = weekly_root / week_label
    weekly_written = False
    if iso_weekday == 7 or not weekly_dir.is_dir():
        _copy_tree_filtered(src, weekly_dir)
        weekly_written = True

    pruned_daily = _prune_old_dirs(dest / "daily", keep_daily)
    pruned_weekly = _prune_old_dirs(weekly_root, keep_weekly)

    return {
        "backedUpFiles": backed_up,
        "skippedFiles": skipped,
        "dailyPath": str(daily_dir),
        "weeklyPath": str(weekly_dir) if weekly_written else None,
        "prunedDaily": pruned_daily,
        "prunedWeekly": pruned_weekly,
        "timestamp": ts.isoformat(timespec="seconds"),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="PlainMark v2 Source-of-Truth Backup")
    parser.add_argument("--source", required=True, help="Path to PlainMarkData")
    parser.add_argument("--dest", required=True, help="Path to backup destination")
    parser.add_argument("--keep-daily", type=int, default=7)
    parser.add_argument("--keep-weekly", type=int, default=4)
    args = parser.parse_args()
    result = run_backup(
        Path(args.source),
        Path(args.dest),
        keep_daily=args.keep_daily,
        keep_weekly=args.keep_weekly,
    )
    print(result)


if __name__ == "__main__":
    main()
