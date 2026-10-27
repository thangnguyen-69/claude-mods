#!/usr/bin/env bash
# Prints the tailnet URL plannotator-tailnet published for one Plannotator review.
#
#   review-link.sh <localhost URL the plannotator tool returned>
#
# Waits up to ~15 s (the mod syncs every 4 s). Exit 0 with the URL on stdout,
# exit 1 with nothing on stdout when no tailnet link exists (mod not installed,
# tailscale down, or still publishing): post the localhost link alone then.
set -euo pipefail
local_url="${1:?usage: review-link.sh <localhost URL>}"
dir="$HOME/.claude/plannotator-tailnet"

for _ in 1 2 3 4 5 6; do
  # This session's own file when the tag is known; otherwise any file listing this
  # URL (a localhost port belongs to one live review at a time).
  if [[ -n "${PLANNOTATOR_SESSION_TAG:-}" ]]; then
    files=("$dir/${PLANNOTATOR_SESSION_TAG#claude-code:}.json")
  else
    files=("$dir"/*.json)
  fi
  url=$(python3 -I - "$local_url" "${files[@]}" <<'PY' || true
import json, sys
want, paths = sys.argv[1].rstrip("/"), sys.argv[2:]
for path in paths:
    try:
        entries = json.load(open(path))
    except (OSError, ValueError):
        continue
    for e in entries if isinstance(entries, list) else []:
        if str(e.get("local", "")).rstrip("/") == want and e.get("tailnet"):
            print(e["tailnet"])
            sys.exit(0)
sys.exit(1)
PY
)
  if [[ -n "$url" ]]; then
    printf '%s\n' "$url"
    exit 0
  fi
  sleep 3
done
echo "no tailnet link for $local_url (plannotator-tailnet not installed, tailscale down, or not published yet)" >&2
exit 1
