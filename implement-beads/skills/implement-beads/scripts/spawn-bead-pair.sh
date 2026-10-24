#!/usr/bin/env bash
# Spawn the implementer + judge pair for ONE bead (implement-beads skill, Step 3).
#   spawn-bead-pair.sh <bead-id> --orch <orchestrator-session-name> [--work <repo/worktree>] [--model <m>]
#                      [--context <file-or-dir>]... [--note "<text>"]...
#     --context/--note (repeatable) add an "Extra context" block to BOTH the judge and implementer
#     prompts: paths they must read before step 1, and free-text instructions. Paths must exist.
#   spawn-bead-pair.sh <bead-id> --close      # close both panes + drop pair-running (after PASS/FAIL)
#   spawn-bead-pair.sh --list-ready <epic-id> # dry run: preflight every open bead under the epic, spawn nothing
# Preflight (refuses to spawn): bead exists, is not an epic, has acceptance criteria, is not
# closed, not labelled needs-judge/judge-pass/pair-running/human/blocked_by_human/blocked-external/
# observe, and every stack-on:<id> upstream already has judge-pass. Being in `bd blocked`
# (open blocking deps) is a refusal in --list-ready and a warning on spawn. Judging whether
# criteria are *measurable* stays with the orchestrator.
#
# Workspace (where bd runs and teammates start): $BEADS_WORKSPACE, else $OL_DEVOPS_ROOT (older
# name), else the nearest directory at or above $PWD holding .beads/. Per-workspace rules for the
# teammates go in <workspace>/.claude/implement-beads/{implementer,judge}.extra.md, appended when present.
set -euo pipefail
SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
S="$SCRIPTS/spawn-teammate.sh"; T="$(dirname "$SCRIPTS")"
WS="${BEADS_WORKSPACE:-${OL_DEVOPS_ROOT:-}}"
if [ -z "$WS" ]; then
  d="$PWD"; while [ "$d" != / ] && [ ! -d "$d/.beads" ]; do d="$(dirname "$d")"; done
  [ -d "$d/.beads" ] && WS="$d"
fi
[ -n "$WS" ] && [ -d "$WS/.beads" ] || { echo "error: no beads workspace: run from inside one, or set BEADS_WORKSPACE (got '${WS:-}')" >&2; exit 2; }
cd "$WS"  # bd needs the workspace root
# preflight.py <id>...: prints "OK <id> | <title>" or "REFUSED <id>: <reasons>"; exit 1 if any refused.
PF=$(cat <<'PY'
import json, subprocess, sys
def show(i):
    r = subprocess.run(["bd", "show", i, "--json"], capture_output=True, text=True)
    if r.returncode: return None
    d = json.loads(r.stdout); return d[0] if isinstance(d, list) else d
# `bd blocked`, not `bd ready`: ready omits in_progress beads that have no blockers.
blocked = {x["id"] for x in json.loads(subprocess.run(["bd", "blocked", "--json"],
           capture_output=True, text=True).stdout or "[]")}
strict = sys.argv[1] == "--strict"; ids = sys.argv[2:]; anybad = False
for i in ids:
    d = show(i)
    if d is None: print(f"REFUSED {i}: bd show failed"); anybad = True; continue
    bad = []; labels = set(d.get("labels") or [])
    if d.get("status") == "closed": bad.append("closed")
    if d.get("issue_type") == "epic": bad.append("epic (milestone criteria, not a pair task)")
    if not (d.get("acceptance_criteria") or "").strip(): bad.append("no acceptance criteria")
    for l in ("needs-judge", "judge-pass", "pair-running", "human", "blocked_by_human", "blocked-external", "observe"):
        if l in labels: bad.append("labelled " + l)
    for l in sorted(labels):
        if l.startswith("stack-on:"):
            up = show(l[len("stack-on:"):])
            if up is None or "judge-pass" not in set(up.get("labels") or []):
                bad.append(f"stacks on {l[9:]} which has no judge-pass yet")
    if i in blocked:
        if strict: bad.append("blocked (open blocking deps)")
        else: print(f"WARN: {i} is in 'bd blocked' - check before trusting this run", file=sys.stderr)
    if bad: print(f"REFUSED {i}: " + "; ".join(bad)); anybad = True
    else: print(f"OK {i} | {d.get('title','')[:90]}")
sys.exit(1 if anybad else 0)
PY
)

if [ "${1:-}" = "--list-ready" ]; then
  EPIC="${2:?usage: spawn-bead-pair.sh --list-ready <epic-id>}"
  mapfile -t ALL < <(python3 - "$EPIC" <<'PY'
import json, subprocess, sys
def kids(p):
    r = subprocess.run(["bd", "list", "--parent", p, "--all", "--json"], capture_output=True, text=True)
    return json.loads(r.stdout or "[]")
seen = []
def walk(p):
    for k in kids(p):
        if k["status"] != "closed" and k["id"] not in seen:
            seen.append(k["id"]); walk(k["id"])
walk(sys.argv[1]); print("\n".join(seen))
PY
)
  [ -n "${ALL[*]}" ] || { echo "no open beads under $EPIC"; exit 0; }
  python3 -c "$PF" --strict "${ALL[@]}" | sort -r || true
  exit 0
fi

ID="${1:?usage: spawn-bead-pair.sh <bead-id> --orch <name> [--work <dir>] [--model <m>] [--context <path>]... [--note <text>]... | --close}"; shift
ORCH=""; WORK="the repo/worktree named in the bead (create a worktree if needed)"; MODEL=""; CLOSE=0; CTX=(); NOTES=()
while [ $# -gt 0 ]; do case "$1" in
  --orch) ORCH="$2"; shift 2;; --work) WORK="$2"; shift 2;; --model) MODEL="$2"; shift 2;;
  --context) CTX+=("$2"); shift 2;; --note) NOTES+=("$2"); shift 2;;
  --close) CLOSE=1; shift;; *) echo "unknown arg $1" >&2; exit 2;; esac; done

SHORT="bd-$(echo "${ID##*-}" | tr . _)"
[[ "$SHORT" =~ ^[a-z][a-z0-9_-]{0,19}$ ]] || { echo "bad short name '$SHORT' (rule: ^[a-z][a-z0-9_-]{0,19}\$)" >&2; exit 2; }

if [ "$CLOSE" = 1 ]; then
  W="/tmp/bead-pair-$SHORT.watcher"
  if [ -f "$W.pid" ]; then kill "$(cat "$W.pid")" 2>/dev/null || true; rm -f "$W.pid"; fi
  "$S" --close "$SHORT-implementer" || true; "$S" --close "$SHORT-judge" || true
  bd label remove "$ID" pair-running || true; exit 0
fi
[ -n "$ORCH" ] || { echo "--orch required (your session name from ListAgents)" >&2; exit 2; }

if ! PFOUT=$(python3 -c "$PF" --lenient "$ID"); then echo "PREFLIGHT $PFOUT"; exit 1; fi

D="$(mktemp -d)"
render() { sed -e "s|__ID__|$ID|g" -e "s|__SHORT__|$SHORT|g" -e "s|__ORCH__|$ORCH|g" -e "s|__WORK__|$WORK|g" \
                -e "s|__SCRIPTS__|$SCRIPTS|g" -e "s|__WS__|$WS|g" "$T/$1" > "$D/$2"
           local x="$WS/.claude/implement-beads/${2%.md}.extra.md"
           if [ -f "$x" ]; then { printf '\n\nRules for this workspace:\n'; cat "$x"; } >> "$D/$2"; fi; }
render judge.tmpl.md judge.md; render implementer.tmpl.md implementer.md
if [ ${#CTX[@]} -gt 0 ] || [ ${#NOTES[@]} -gt 0 ]; then
  X=$'\n\nExtra context from the orchestrator (applies to you before step 1 and to the whole task):'
  for c in "${CTX[@]}"; do
    [ -e "$c" ] || { echo "--context path not found: $c" >&2; exit 2; }
    X+=$'\n- Read first: '"$c"$([ -d "$c" ] && echo " (directory: read its CLAUDE.md, then SPEC/REPORT/TRACKER or README if present)" || true)
  done
  for n in "${NOTES[@]}"; do X+=$'\n- '"$n"; done
  printf "%s\n" "$X" | tee -a "$D/judge.md" >> "$D/implementer.md"
fi
M=(); [ -n "$MODEL" ] && M=(--model "$MODEL")
# Layout: implementer splits right of the orchestrator. The judge is NOT started yet (RAM):
# a detached shell watcher waits for needs-judge, then spawns the judge stacked below the
# implementer. Pid/log: /tmp/bead-pair-<short>.watcher.{pid,log}; --close kills it.
I_OUT=$("$S" --name "$SHORT-implementer" --prompt-file "$D/implementer.md" --cwd "$WS" "${M[@]}")
I_PANE=$(echo "$I_OUT" | sed -n 's/.*PANE //p' | head -1)
bd label add "$ID" pair-running
bd note "$ID" "pair: $SHORT-implementer $I_PANE; judge spawns on needs-judge (watcher /tmp/bead-pair-$SHORT.watcher.log)"
W="/tmp/bead-pair-$SHORT.watcher"
setsid nohup bash -c '
  ID=$1 SHORT=$2 ORCH=$3 S=$4 JD=$5 I_PANE=$6 MODEL=$7 SCRIPTS=$8 WS=$9
  set +e
  cd "$WS"; LINE=$("$SCRIPTS/wait-bead-label.sh" "$ID" needs-judge); RC=$?
  echo "$(date -Is) wait: rc=$RC $LINE"
  if [ "$RC" != 0 ]; then
    # Hand the wait result to the judge; its template turns 3/4/5 into a FAIL to the orchestrator.
    printf "\n\nThe handoff watcher already ran step 2 and ended with exit %s: %s\nTreat that as your step-2 result; do not re-arm the wait for it.\n" "$RC" "$LINE" >> "$JD"
  fi
  M=(); [ -n "$MODEL" ] && M=(--model "$MODEL")
  SPLIT=(); herdr agent get "$SHORT-implementer" >/dev/null 2>&1 && SPLIT=(--split-from "$I_PANE" --direction down)
  J_OUT=$("$S" --name "$SHORT-judge" --prompt-file "$JD" --cwd "$WS" "${M[@]}" --report-to "$ORCH" "${SPLIT[@]}" 2>&1); echo "$J_OUT"
  bd note "$ID" "judge spawned: $(echo "$J_OUT" | grep ^TEAMMATE)"
  rm -f "$0.pid"
' "$W" "$ID" "$SHORT" "$ORCH" "$S" "$D/judge.md" "$I_PANE" "$MODEL" "$SCRIPTS" "$WS" >"$W.log" 2>&1 < /dev/null &
echo $! > "$W.pid"
echo "$I_OUT"; echo "WATCHER $SHORT-judge PID $(cat "$W.pid") LOG $W.log"
