#!/usr/bin/env python3

"""Print a compact regression scaffold for a visible or brittle UI fix."""

from __future__ import annotations

import argparse
import sys


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--name", required=True, help="Short regression name.")
    parser.add_argument("--failure", required=True, help="What failed before the fix.")
    parser.add_argument("--proof", required=True, help="What now proves the fix.")
    args = parser.parse_args(argv)

    print(f"Regression: {args.name}")
    print(f"Before: {args.failure}")
    print(f"Proof: {args.proof}")
    print("")
    print("Suggested assertions:")
    print("- Reproduce the failing gesture in the launched app.")
    print("- Verify the reachable hit target or visible state that failed before.")
    print("- Keep the test narrow and named after the original bug.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
