#!/usr/bin/env bash
# Spawn ONE teammate: a new terminal pane running a named Claude Code session,
# given a specified name and a specified prompt.
#
# Any agent can call it to bring up a single teammate with an arbitrary
# name and prompt -- the prompt is passed
# to claude as its initial prompt, so the teammate starts working on it
# immediately, no SendMessage handoff needed. Follow-up messages to the
# teammate go via SendMessage using the name printed below (it is the
# session name, and under herdr also the agent name).
#
#   spawn-teammate.sh --name <name> (--prompt <text> | --prompt-file <path>)
#                      [--cwd <dir>] [--mux herdr] [--direction right|down]
#                      [--model <alias-or-id>] [--report-to <session-name>]
#                      [--split-from <pane_id>]
#   spawn-teammate.sh --close <name>
#
#   split-from optional. Split this pane instead of the caller's current
#            one, e.g. `--split-from <implementer pane> --direction down`
#            to stack a second teammate under the first.
#   report-to optional. Appends a standard footer to the prompt telling the
#            teammate to report back to that session with SendMessage when
#            done or blocked. Needs a non-empty prompt.
#   close    closes the named teammate's pane, resolved via
#            `herdr agent get <name>`. Never kills the claude process
#            directly (see Cleanup below).
#
#   model    optional. Passed to claude as `--model <model>` (alias like
#            opus/sonnet/haiku, or a full id like claude-opus-5-5). Omit to
#            use claude's default model.
#   name     required. Becomes the claude session name (-n) and the herdr
#            agent name, so it must match herdr's agent naming rule:
#            [a-z][a-z0-9_-]{0,31}, unique among live agents.
#   prompt   the teammate's first turn. May contain newlines and quotes.
#            Omit (or pass --prompt '') to start the teammate idle -- e.g.
#            when the dispatch will arrive via SendMessage right after.
#   cwd      working dir for the spawned session. Defaults to the workspace
#            root (BEADS_WORKSPACE, then OL_DEVOPS_ROOT, then the git top
#            level of $PWD, then $PWD). Prefer the root over a subfolder:
#            the pane inherits that dir's own .claude/settings.json and
#            CLAUDE.md.
#
# Multiplexer: herdr only. Run from inside a herdr session (HERDR_ENV=1) --
# herdr has no out-of-session entry point. zellij support was removed
# 2026-10-19; `--mux herdr` is still accepted for old callers, any other
# --mux value is an error.
#
# The pane gets TEAMMATE_NAME=<name> in its environment, so hooks in the
# teammate's session can tell who they run for (hook stdin carries the
# session id, not the -n name) -- e.g. hooks/implementer-no-bead-close.sh.
# It also gets ORCH_SESSION_ID=<caller's CLAUDE_CODE_SESSION_ID>, so a hook
# in the teammate can attribute its work to the spawning session. Both are
# also exported under their older names OL_TEAMMATE_NAME / OL_ORCH_SESSION_ID.
#
# Output, on success, one line per teammate (parse-friendly):
#   TEAMMATE <name> SESSION <name> PANE <pane_id>
#
# Cleanup: `spawn-teammate.sh --close <name>`, or `herdr pane close <pane_id>`
# -- NEVER kill/pkill the pane's claude process (under the old zellij setup
# that crashed the whole mux server).
set -euo pipefail

usage() {
  echo "usage: $(basename "$0") --name <name> (--prompt <text> | --prompt-file <path>) [--cwd <dir>] [--mux herdr] [--direction right|down] [--model <model>] [--report-to <session>] [--split-from <pane_id>]" >&2
  echo "       $(basename "$0") --close <name>" >&2
  exit 2
}

NAME="" PROMPT="" PROMPT_FILE="" CWD="" MUX="" DIRECTION="right" MODEL="" REPORT_TO="" CLOSE="" SPLIT_FROM=""
while [ $# -gt 0 ]; do
  case "$1" in
    --name)        [ $# -ge 2 ] || usage; NAME=$2; shift 2 ;;
    --prompt)      [ $# -ge 2 ] || usage; PROMPT=$2; shift 2 ;;
    --prompt-file) [ $# -ge 2 ] || usage; PROMPT_FILE=$2; shift 2 ;;
    --cwd)         [ $# -ge 2 ] || usage; CWD=$2; shift 2 ;;
    --mux)         [ $# -ge 2 ] || usage; MUX=$2; shift 2 ;;
    --model)       [ $# -ge 2 ] || usage; MODEL=$2; shift 2 ;;
    --report-to)   [ $# -ge 2 ] || usage; REPORT_TO=$2; shift 2 ;;
    --close)       [ $# -ge 2 ] || usage; CLOSE=$2; shift 2 ;;
    --direction)   [ $# -ge 2 ] || usage; DIRECTION=$2; shift 2 ;;
    --split-from)  [ $# -ge 2 ] || usage; SPLIT_FROM=$2; shift 2 ;;
    *)             usage ;;
  esac
done

[ -z "$CLOSE" ] || [ -z "$NAME" ] || usage
[ -n "$NAME" ] || [ -n "$CLOSE" ] || usage
case "$MUX" in
  ""|herdr) ;;
  zellij) echo "error: zellij support removed 2026-10-19; run inside herdr" >&2; exit 2 ;;
  *) usage ;;
esac
if [ "${HERDR_ENV:-}" != "1" ]; then
  echo "error: not inside a herdr session (HERDR_ENV!=1) -- zellij support removed 2026-10-19; run inside herdr" >&2
  exit 2
fi
command -v jq >/dev/null 2>&1 || { echo "error: needs 'jq' on PATH to parse herdr responses" >&2; exit 2; }
case "$DIRECTION" in right|down) ;; *) usage ;; esac
case "$MODEL" in
  *[!a-zA-Z0-9._:\[\]-]*) echo "error: invalid --model '$MODEL'" >&2; exit 2 ;;
esac
MODEL_ARGS=()
[ -z "$MODEL" ] || MODEL_ARGS=(--model "$MODEL")

if [ -n "$PROMPT" ] && [ -n "$PROMPT_FILE" ]; then
  echo "error: --prompt and --prompt-file are mutually exclusive" >&2; exit 2
fi
if [ -n "$PROMPT_FILE" ]; then
  [ -f "$PROMPT_FILE" ] || { echo "error: prompt file not found: $PROMPT_FILE" >&2; exit 2; }
  PROMPT=$(cat "$PROMPT_FILE")
fi

# --- close -----------------------------------------------------------------
# Close a teammate's pane by name via herdr's own pane close, never a kill of
# the claude process.
if [ -n "$CLOSE" ]; then
  if agent_json=$(herdr agent get "$CLOSE" 2>/dev/null); then
    pane_id=$(echo "$agent_json" | jq -r '.result.agent.pane_id // empty')
  else
    # A start that hit the readiness timeout leaves the pane running but never
    # registers the herdr agent name; claude's -n still sets the pane title.
    agent_json=$(herdr agent list)
    pane_id=$(echo "$agent_json" | jq -r --arg n "$CLOSE" '[.result.agents[] | select(.terminal_title_stripped == $n)][0].pane_id // empty')
    [ -n "$pane_id" ] || { echo "error: no herdr agent or pane titled '$CLOSE'" >&2; exit 1; }
  fi
  [ -n "$pane_id" ] || { echo "error: herdr agent '$CLOSE' has no pane_id: $agent_json" >&2; exit 1; }
  herdr pane close "$pane_id" >/dev/null
  echo "CLOSED $CLOSE PANE $pane_id"
  exit 0
fi

if [ -n "$REPORT_TO" ]; then
  [ -n "$PROMPT" ] || { echo "error: --report-to needs a non-empty prompt" >&2; exit 2; }
  PROMPT="$PROMPT

---
Your coordinator is the session named \`$REPORT_TO\`. When you finish, or hit a blocker you cannot clear yourself, report back with SendMessage to \`$REPORT_TO\` -- a short result plus full URLs for every PR/build/ticket. Do not rely on anyone relaying it."
fi

# herdr agent names: [a-z][a-z0-9_-]{0,31}, unique among live agents.
case "$NAME" in
  [a-z]*[!a-z0-9_-]*|[!a-z]*|"")
    echo "error: name must match [a-z][a-z0-9_-]{0,31} (got '$NAME')" >&2; exit 2 ;;
esac
[ ${#NAME} -le 32 ] || { echo "error: herdr agent name max 32 chars (got ${#NAME})" >&2; exit 2; }

CWD=${CWD:-${BEADS_WORKSPACE:-${OL_DEVOPS_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}}}
[ -d "$CWD" ] || { echo "error: cwd does not exist: $CWD" >&2; exit 2; }

# --- herdr -----------------------------------------------------------------
# Panes are real interactive shells (they source the user's normal shell rc),
# but pass PATH explicitly via --env anyway (cheap, removes doubt for a
# non-login rc setup). Split off the current pane so the teammate lands in
# the caller's own tab.
BD=$(command -v bd || true)
if [ -z "$BD" ]; then
  echo "warning: 'bd' not found on PATH -- spawned pane may not be able to run bd commands" >&2
fi
PATH_ENV="PATH=${BD:+$(dirname "$BD"):}$PATH"

SPLIT_TARGET=(--current)
[ -z "$SPLIT_FROM" ] || SPLIT_TARGET=(--pane "$SPLIT_FROM")
# Claude Code sets CLAUDE_CODE_SESSION_ID in its Bash tool env; it survives into
# spawn-bead-pair's detached judge watcher, so both teammates point at the caller.
ORCH_ENV=()
[ -z "${CLAUDE_CODE_SESSION_ID:-}" ] || ORCH_ENV=(--env "ORCH_SESSION_ID=$CLAUDE_CODE_SESSION_ID" --env "OL_ORCH_SESSION_ID=$CLAUDE_CODE_SESSION_ID")
split_json=$(herdr pane split "${SPLIT_TARGET[@]}" --direction "$DIRECTION" --cwd "$CWD" --env "$PATH_ENV" \
  --env "TEAMMATE_NAME=$NAME" --env "OL_TEAMMATE_NAME=$NAME" "${ORCH_ENV[@]}" --no-focus)
pane_id=$(echo "$split_json" | jq -r '.result.pane.pane_id')
if [ -z "$pane_id" ] || [ "$pane_id" = "null" ]; then
  echo "error: herdr pane split did not return a pane_id: $split_json" >&2
  exit 1
fi

# Reuse the name as the herdr agent name so herdr's own state
# (idle/working/blocked) is inspectable via that same identifier.
# The prompt goes to claude as its initial positional prompt, so the
# teammate's first turn starts immediately -- no SendMessage handoff.
# herdr's own default readiness timeout (30000ms) is too tight for a claude
# startup under load -- bump to its max. Seen 2026-09-15: first spawn
# attempt failed with "timed out waiting for agent startup", a bare retry
# succeeded, meaning startup just needed more than 30s, not a real failure.
#
# herdr's argv encoder REJECTS any argument containing newlines
# ("invalid_agent_argument: agent arguments cannot be encoded safely for
# the target shell", seen 2026-09-17) -- so a multi-line prompt can never
# go through argv. Workaround: start claude with a single-line pointer
# prompt telling it to read the prompt file, then type the full prompt
# into the pane via send-text. send-text needs the pane focused to land
# reliably, so focus it first (--no-focus on the split above means the
# coordinator keeps its own focus meanwhile).
#
# Even 300s is not always enough (2026-10-20: 4 of 13 pair spawns timed out).
# The claude in the pane still started and got its prompt, but the timeout
# exit made callers skip their follow-up (labels, judge watcher). So on that
# one error, confirm a claude is running in the pane and carry on.
start_agent() {
  local out
  out=$(herdr agent start "$@" 2>&1) && return 0
  if echo "$out" | grep -q "timed out waiting for agent startup"; then
    for _ in 1 2 3 4 5 6; do
      if herdr agent list | jq -e --arg p "$pane_id" '.result.agents[] | select(.pane_id == $p and .agent == "claude")' >/dev/null; then
        echo "warn: herdr startup timeout for $NAME, but claude is running in $pane_id; continuing (agent name may be unregistered, pane title is $NAME)" >&2
        return 0
      fi
      sleep 10
    done
  fi
  echo "$out" >&2
  return 1
}
if [ -n "$PROMPT" ]; then
  case "$PROMPT" in
    *$'\n'*)
      # Multi-line: write it to a temp file the pane's claude can read,
      # start idle-ish with a one-line pointer, then paste the pointer
      # as the first turn. The file, not the argv, carries the content.
      PROMPT_FILE=$(mktemp "/tmp/spawn-teammate-${NAME}-prompt.XXXXXX.md")
      printf '%s\n' "$PROMPT" > "$PROMPT_FILE"
      chmod 644 "$PROMPT_FILE"
      start_agent "$NAME" --kind claude --pane "$pane_id" --timeout 300000 -- \
        "${MODEL_ARGS[@]}" -n "$NAME" "Read the file $PROMPT_FILE and do what it says." >/dev/null
      ;;
    *)
      start_agent "$NAME" --kind claude --pane "$pane_id" --timeout 300000 -- "${MODEL_ARGS[@]}" -n "$NAME" "$PROMPT" >/dev/null
      ;;
  esac
else
  start_agent "$NAME" --kind claude --pane "$pane_id" --timeout 300000 -- "${MODEL_ARGS[@]}" -n "$NAME" >/dev/null
fi
echo "TEAMMATE $NAME SESSION $NAME PANE $pane_id"
echo "PROMPT_FILE ${PROMPT_FILE:-<inline>}"
exit 0
