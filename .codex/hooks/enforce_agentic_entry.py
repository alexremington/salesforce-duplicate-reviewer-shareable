#!/usr/bin/env python3

import json
import re
import sys


SCOPE_LABEL = "salesforce-duplicate-reviewer"
WORKFLOW_HINT = "Use $agentic-delivery:"
ALLOW_WORKFLOW_MARKERS = (
    "$agentic-delivery",
    "agentic delivery",
    "agentic workflow",
    "agent workflow",
    "use the agent workflow",
    "use agentic-delivery",
)
ALLOW_HUME_WAIVER_MARKERS = (
    "waive hume",
    "without hume",
    "skip hume",
    "no hume",
    "hume waived",
)
FOLLOW_UP_MARKERS = (
    "yes",
    "yes please",
    "go ahead",
    "proceed",
    "continue",
    "do it",
    "let's do it",
    "sounds good",
)
READ_ONLY_MARKERS = (
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
DEVELOPMENT_PATTERNS = (
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
HIGH_RISK_PATTERNS = (
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
    r"\blauncher\b",
    r"\bruntime\b",
    r"\bworkflow\b",
    r"\barchitecture\b",
    r"\bmulti-file\b",
    r"\bmultiple files\b",
    r"\bcross-platform\b",
    r"\bbrittle\b",
    r"\bsmoke\b",
    r"\bplaywright\b",
    r"\bqa\b",
    r"\bhume\b",
    r"\bmerge\b",
    r"\bsalesforce\b",
)
VISIBLE_UI_PATTERNS = (
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
LOW_RISK_MARKERS = (
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


def is_short_follow_up(text: str) -> bool:
    return len(text.split()) <= 6 and text in FOLLOW_UP_MARKERS


def looks_read_only(text: str) -> bool:
    return contains_any(text, READ_ONLY_MARKERS)


def workflow_invoked(text: str) -> bool:
    return contains_any(text, ALLOW_WORKFLOW_MARKERS)


def hume_satisfied(text: str) -> bool:
    return "hume" in text or contains_any(text, ALLOW_HUME_WAIVER_MARKERS)


def is_low_risk_direct_entry(text: str, is_visible_ui: bool) -> bool:
    if is_visible_ui:
        return False
    if contains_any(text, HIGH_RISK_PATTERNS):
        return False
    return contains_any(text, LOW_RISK_MARKERS)


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


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError:
        return 0

    prompt = normalize(payload.get("prompt", ""))
    if not prompt:
        return 0

    if is_short_follow_up(prompt) or looks_read_only(prompt):
        return 0

    is_development = contains_any(prompt, DEVELOPMENT_PATTERNS)
    is_visible_ui = contains_any(prompt, VISIBLE_UI_PATTERNS)

    if not is_development:
        return 0

    if is_low_risk_direct_entry(prompt, is_visible_ui):
        add_context(
            "This looks like low-risk development work in salesforce-duplicate-reviewer. A lightweight path is "
            "allowed: keep the change narrow, skip architect unless the scope expands, and only pull in reviewer "
            "or qa-ux if risk increases."
        )
        return 0

    if not workflow_invoked(prompt):
        reason = (
            f"New development requests in {SCOPE_LABEL} must enter through the agent workflow. "
            f"Re-submit your request beginning with '{WORKFLOW_HINT}'."
        )
        if is_visible_ui:
            reason += " Visible UI work must also mention Hume or explicitly waive Hume."
        block(reason)
        return 0

    if is_visible_ui and not hume_satisfied(prompt):
        block(
            "Visible UI development in salesforce-duplicate-reviewer must mention Hume or explicitly waive Hume. "
            "Re-submit with Hume included in the request."
        )
        return 0

    add_context(
        "This is development work in an enforced agent workflow for salesforce-duplicate-reviewer. Use architect "
        "before non-trivial edits, keep implementation single-writer by default, then run reviewer and qa-ux "
        "before closeout. Use Hume first for visible UI unless the user explicitly waived it."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
