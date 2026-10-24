#!/usr/bin/env bash
# PreToolUse guard for implement-beads pairs: a session whose teammate name
# ends in "-implementer" may not close a bead (or self-grant judge-pass).
# Closing is the judge's job -- the implementer hands off by labelling the
# bead needs-judge. Every other session passes through untouched.
#
# Name source, in order:
#   1. TEAMMATE_NAME (or the older OL_TEAMMATE_NAME) -- exported into the
#      pane by spawn-teammate.sh
#   2. herdr agent name of HERDR_PANE_ID (agents started via `herdr agent
#      start <name>`) -- only queried when the command looks like a close,
#      so ordinary Bash calls never pay for it.
# Hook stdin carries session_id but not the -n session name, hence the env.
# This is a guardrail against forgetting the rule, not a security boundary.

set -euo pipefail

input=$(cat)

[[ "$(jq -r '.tool_name // empty' <<<"$input")" == "Bash" ]] || exit 0
cmd=$(jq -r '.tool_input.command // empty' <<<"$input")

# Cheap pre-filter: no `bd` invocation, nothing to check.
grep -qE '(^|[^[:alnum:]_.-])bd[[:space:]]' <<<"$cmd" || exit 0

# Ways to close a bead (bd --help, 2026-10-19), plus self-granting judge-pass.
close_re='(^|[^[:alnum:]_.-])bd[[:space:]]+((close|duplicate|supersede|delete)\b|human[[:space:]]+(respond|dismiss)\b|todo[[:space:]]+done\b|update\b.*(--status[[:space:]=]+|-s[[:space:]]+)["'"'"']?closed\b|(label[[:space:]]+add|tag)\b.*\bjudge-pass\b)'
grep -qE "$close_re" <<<"$cmd" || exit 0

name=${TEAMMATE_NAME:-${OL_TEAMMATE_NAME:-}}
if [[ -z "$name" && -n "${HERDR_PANE_ID:-}" ]] && command -v herdr >/dev/null 2>&1; then
  name=$(herdr agent get "$HERDR_PANE_ID" 2>/dev/null | jq -r '.result.agent.name // empty' 2>/dev/null || true)
fi

[[ "$name" == *-implementer ]] || exit 0

reason="Blocked: this session ($name) is an implement-beads IMPLEMENTER and may not close a bead or add judge-pass. Hand off instead: (1) bd note <id> \"<evidence: full PR / build / log URLs, one per acceptance criterion>\"; (2) bd label add <id> needs-judge; (3) stop and wait. The paired judge verifies and closes it, or messages you its findings."

jq -n --arg reason "$reason" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $reason
  }
}'

exit 0
