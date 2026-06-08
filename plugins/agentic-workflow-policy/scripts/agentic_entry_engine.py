#!/usr/bin/env python3

import json
import re
import sys
from pathlib import Path


COMMON_WORKFLOW_MARKERS = (
    "$agentic-delivery",
    "agentic delivery",
    "agentic workflow",
    "agent workflow",
    "use the agent workflow",
    "use agentic-delivery",
)
COMMON_HUME_WAIVER_MARKERS = (
    "waive hume",
    "without hume",
    "skip hume",
    "no hume",
    "hume waived",
)
COMMON_FOLLOW_UP_MARKERS = (
    "yes",
    "yes please",
    "go ahead",
    "proceed",
    "continue",
    "do it",
    "let's do it",
    "sounds good",
)
COMMON_READ_ONLY_MARKERS = (
    "would it make sense",
    "is there any chance",
    "what do you think",
    "brainstorm",
    "explain",
    "read-only",
    "question",
    "why is",
    "how does",
)
COMMON_DEVELOPMENT_PATTERNS = (
    r"\bimplement\b",
    r"\bbuild\b",
    r"\badd\b",
    r"\bupdate\b",
    r"\bfix\b",
    r"\brefactor\b",
    r"\bcreate\b",
    r"\bwire\b",
    r"\bconfigure\b",
    r"\bset up\b",
    r"\bscaffold\b",
    r"\bharden\b",
    r"\benforce\b",
    r"\bdebug\b",
    r"\btest\b",
    r"\breview\b",
    r"\bedit\b",
    r"\bpatch\b",
    r"\bchange\b",
    r"\bship\b",
    r"\bpush\b",
)
COMMON_VISIBLE_UI_PATTERNS = (
    r"\bui\b",
    r"\bux\b",
    r"\bdesign\b",
    r"\blayout\b",
    r"\bvisual\b",
    r"\bfrontend\b",
    r"\bbutton\b",
    r"\bheader\b",
    r"\bmodal\b",
    r"\bpanel\b",
    r"\bcss\b",
    r"\bstyle\b",
    r"\bspacing\b",
    r"\bscroll\b",
    r"\boverflow\b",
    r"\bresponsive\b",
    r"\bviewport\b",
    r"\bscreen\b",
    r"\bpage\b",
)
COMMON_LOW_RISK_MARKERS = (
    "small",
    "minor",
    "tiny",
    "single-file",
    "single file",
    "one file",
    "typo",
    "copy edit",
    "wording",
    "comment",
    "rename",
    "readme",
    "docs",
    "documentation",
    "config-only",
    "config only",
    "test-only",
    "test only",
)


def load_config(path_str: str) -> dict:
    path = Path(path_str)
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def contains_any(text: str, patterns) -> bool:
    for pattern in patterns:
        if pattern.startswith(r"\b"):
            if re.search(pattern, text):
                return True
        elif pattern in text:
            return True
    return False


def is_short_follow_up(text: str, follow_up_markers) -> bool:
    return len(text.split()) <= 6 and text in follow_up_markers


def looks_read_only(text: str, read_only_markers) -> bool:
    return contains_any(text, read_only_markers)


def workflow_invoked(text: str, workflow_markers) -> bool:
    return contains_any(text, workflow_markers)


def hume_satisfied(text: str, hume_waiver_markers) -> bool:
    return "hume" in text or contains_any(text, hume_waiver_markers)


def is_low_risk_direct_entry(text: str, is_visible_ui: bool, high_risk_patterns, low_risk_markers) -> bool:
    if is_visible_ui:
        return False
    if contains_any(text, high_risk_patterns):
        return False
    return contains_any(text, low_risk_markers)


def block(reason: str) -> None:
    print(json.dumps({"decision": "block", "reason": reason}))


def add_context(message: str) -> None:
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "UserPromptSubmit",
                    "additionalContext": message,
                }
            }
        )
    )


def merged_patterns(config: dict, key: str, common_values) -> tuple:
    extra = tuple(config.get(key, []))
    return tuple(common_values) + extra


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: agentic_entry_engine.py <config.json>", file=sys.stderr)
        return 1

    config = load_config(sys.argv[1])
    workflow_markers = merged_patterns(config, "workflow_markers", COMMON_WORKFLOW_MARKERS)
    hume_waiver_markers = merged_patterns(config, "hume_waiver_markers", COMMON_HUME_WAIVER_MARKERS)
    follow_up_markers = merged_patterns(config, "follow_up_markers", COMMON_FOLLOW_UP_MARKERS)
    read_only_markers = merged_patterns(config, "read_only_markers", COMMON_READ_ONLY_MARKERS)
    development_patterns = merged_patterns(config, "development_patterns", COMMON_DEVELOPMENT_PATTERNS)
    visible_ui_patterns = merged_patterns(config, "visible_ui_patterns", COMMON_VISIBLE_UI_PATTERNS)
    low_risk_markers = merged_patterns(config, "low_risk_markers", COMMON_LOW_RISK_MARKERS)
    high_risk_patterns = tuple(config.get("high_risk_patterns", []))

    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError:
        return 0

    prompt = normalize(payload.get("prompt", ""))
    if not prompt:
        return 0

    if is_short_follow_up(prompt, follow_up_markers) or looks_read_only(prompt, read_only_markers):
        return 0

    is_development = contains_any(prompt, development_patterns)
    is_visible_ui = contains_any(prompt, visible_ui_patterns)
    if not is_development:
        return 0

    if is_low_risk_direct_entry(prompt, is_visible_ui, high_risk_patterns, low_risk_markers):
        add_context(config["low_risk_context"])
        return 0

    if not workflow_invoked(prompt, workflow_markers):
        reason = (
            f"New development requests in {config['scope_label']} must enter through the agent workflow. "
            f"Re-submit your request beginning with '{config['workflow_hint']}'."
        )
        if is_visible_ui:
            reason += " Visible UI work must also mention Hume or explicitly waive Hume."
        block(reason)
        return 0

    if is_visible_ui and not hume_satisfied(prompt, hume_waiver_markers):
        block(config["missing_hume_reason"])
        return 0

    add_context(config["workflow_context"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
