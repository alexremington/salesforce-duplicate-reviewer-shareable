#!/usr/bin/env python3

"""Report a safe public-branch mirror path for a repo with private/public history."""

from __future__ import annotations

import argparse
import shlex
import subprocess
import sys
from pathlib import Path

PUBLIC_SAFE_PATHS = (
    "AGENTS.md",
    ".codex/config.toml",
    "plugins/agentic-workflow-policy",
)
PUBLIC_SAFE_PATTERNS = (
    "/Users/aremington",
    "OneDrive-POLITICO",
    "C:/Users/runneradmin",
    "C:\\Users\\runneradmin",
)


def run_git(repo: Path, *args: str, allow_no_match: bool = False) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo), *args],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        if allow_no_match and result.returncode == 1:
            return ""
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "git command failed")
    return result.stdout.strip()


def scan_public_safe(repo: Path, branch: str) -> list[str]:
    hits = []
    for pattern in PUBLIC_SAFE_PATTERNS:
        match_output = run_git(
            repo,
            "grep",
            "-n",
            "-F",
            pattern,
            branch,
            "--",
            *PUBLIC_SAFE_PATHS,
            allow_no_match=True,
        )
        if match_output:
            hits.extend(match_output.splitlines())
    return hits


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, help="Repository path.")
    parser.add_argument("--source-branch", default="main", help="Private branch to mirror from.")
    parser.add_argument("--public-branch", default="public/main", help="Public branch to mirror to.")
    parser.add_argument(
        "--assert-public-safe",
        action="store_true",
        help="Fail if the public branch still contains local-path markers in mirrored policy files.",
    )
    args = parser.parse_args(argv)

    repo = Path(args.repo).expanduser()
    if not repo.exists():
        print(f"repo missing: {repo}", file=sys.stderr)
        return 2

    try:
        inside = run_git(repo, "rev-parse", "--is-inside-work-tree")
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    if inside != "true":
        print(f"not a git repo: {repo}", file=sys.stderr)
        return 2

    try:
        status = run_git(repo, "status", "--porcelain")
        source = run_git(repo, "rev-parse", args.source_branch)
        public = run_git(repo, "rev-parse", args.public_branch)
        base = run_git(repo, "merge-base", args.source_branch, args.public_branch)
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    print(f"repo: {repo}")
    print(f"source_branch: {args.source_branch} ({source})")
    print(f"public_branch: {args.public_branch} ({public})")
    print(f"merge_base: {base}")
    print(f"working_tree_clean: {'yes' if not status else 'no'}")

    if args.assert_public_safe:
        hits = scan_public_safe(repo, args.public_branch)
        if hits:
            print("public-safe scan failed:")
            for hit in hits:
                print(hit)
            return 1
        print("public-safe scan passed")

    if source == public:
        print("status: already in sync")
        return 0

    print("status: diverged")
    print("safe_path:")
    quoted_repo = shlex.quote(str(repo))
    print(f"1. `git -C {quoted_repo} checkout -b public-sync-{source[:8]} {args.public_branch}`")
    print(f"2. `git -C {quoted_repo} cherry-pick {base}..{args.source_branch}`")
    print(f"3. Review, resolve conflicts, then push the public-sync branch.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
