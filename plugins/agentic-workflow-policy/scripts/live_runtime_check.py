#!/usr/bin/env python3

"""Compare a checked-out source file or tree to a live runtime copy."""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
import sys


def digest_file(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def digest_tree(path: Path) -> str:
    hasher = hashlib.sha256()
    for entry in sorted(path.rglob("*")):
        relative = entry.relative_to(path).as_posix()
        hasher.update(relative.encode("utf-8"))
        if entry.is_file():
            hasher.update(b"\0file\0")
            with entry.open("rb") as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    hasher.update(chunk)
        elif entry.is_dir():
            hasher.update(b"\0dir\0")
    return hasher.hexdigest()


def digest(path: Path) -> str:
    if path.is_dir():
        return digest_tree(path)
    return digest_file(path)


def describe(path: Path) -> dict:
    stat = path.stat()
    return {
        "path": str(path),
        "size": stat.st_size,
        "mtime": int(stat.st_mtime),
        "sha256": digest(path),
    }


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, help="Path to the checked-out source file or tree root.")
    parser.add_argument("--live", required=True, help="Path to the live runtime file or tree root.")
    args = parser.parse_args(argv)

    source = Path(args.source).expanduser()
    live = Path(args.live).expanduser()

    if not source.exists():
        print(f"source missing: {source}", file=sys.stderr)
        return 2
    if not live.exists():
        print(f"live runtime missing: {live}", file=sys.stderr)
        return 2

    source_info = describe(source)
    live_info = describe(live)

    print("source:", source_info["path"])
    print("live:", live_info["path"])
    print("source_mtime:", source_info["mtime"])
    print("live_mtime:", live_info["mtime"])
    print("source_sha256:", source_info["sha256"])
    print("live_sha256:", live_info["sha256"])

    if source_info["sha256"] == live_info["sha256"]:
        print("status: in sync")
        return 0

    if live_info["mtime"] < source_info["mtime"]:
        print("status: live runtime looks older than source")
    else:
        print("status: content differs")
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
