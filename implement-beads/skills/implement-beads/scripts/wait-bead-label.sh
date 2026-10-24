#!/usr/bin/env bash
# Block until a bead carries a label -- the implement-beads judge's wake-up.
# Run it with Bash run_in_background: true; the harness re-invokes the judge
# when it exits, so there is no polling in the judge's own context.
#
#   wait-bead-label.sh <bead-id> [label] [--max-wait <seconds>] [--interval <seconds>]
#
#   label       default needs-judge
#   --max-wait  default 21600 (6h); 0 = no limit
#   --interval  default 10
#
# Exit codes (one status line on stdout either way):
#   0  label present            LABEL <id> <label>
#   3  bead closed first        CLOSED <id>
#   4  max-wait reached         TIMEOUT <id> <label> after <n>s
#   5  bd failed 3 polls running BD_ERROR <id> <last error>
#   2  usage
#
# bd stderr is kept, not discarded: a silently broken probe would otherwise
# look exactly like a timeout.
set -euo pipefail

usage() {
  echo "usage: $(basename "$0") <bead-id> [label] [--max-wait <seconds>] [--interval <seconds>]" >&2
  exit 2
}

ID="" LABEL="needs-judge" MAX_WAIT=21600 INTERVAL=10
POS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --max-wait) [ $# -ge 2 ] || usage; MAX_WAIT=$2; shift 2 ;;
    --interval) [ $# -ge 2 ] || usage; INTERVAL=$2; shift 2 ;;
    -*)         usage ;;
    *)          POS+=("$1"); shift ;;
  esac
done
[ ${#POS[@]} -ge 1 ] && [ ${#POS[@]} -le 2 ] || usage
ID=${POS[0]}
[ ${#POS[@]} -eq 2 ] && LABEL=${POS[1]}
case "$MAX_WAIT$INTERVAL" in *[!0-9]*) usage ;; esac
[ "$INTERVAL" -ge 1 ] || usage

command -v bd >/dev/null 2>&1 || { echo "BD_ERROR $ID bd not on PATH"; exit 5; }
command -v jq >/dev/null 2>&1 || { echo "BD_ERROR $ID jq not on PATH"; exit 5; }

start=$SECONDS
fails=0
while :; do
  if out=$(bd show "$ID" --json 2>&1) &&
     rec=$(jq -ce 'if type == "array" then .[0] else . end' <<<"$out" 2>&1); then
    fails=0
    if jq -e --arg l "$LABEL" '(.labels // []) | index($l)' <<<"$rec" >/dev/null; then
      echo "LABEL $ID $LABEL"
      exit 0
    fi
    if [ "$(jq -r '.status' <<<"$rec")" = "closed" ]; then
      echo "CLOSED $ID"
      exit 3
    fi
  else
    fails=$((fails + 1))
    echo "warning: bd show $ID failed ($fails/3): ${out//$'\n'/ }" >&2
    if [ "$fails" -ge 3 ]; then
      echo "BD_ERROR $ID ${out//$'\n'/ }"
      exit 5
    fi
  fi
  if [ "$MAX_WAIT" -gt 0 ] && [ $((SECONDS - start)) -ge "$MAX_WAIT" ]; then
    echo "TIMEOUT $ID $LABEL after $((SECONDS - start))s"
    exit 4
  fi
  sleep "$INTERVAL"
done
