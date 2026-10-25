# plannotator-tailnet

Publishes *this* Claude session's live Plannotator reviews on the tailnet, so a
plan, a diff or a document can be reviewed from a phone or another machine
instead of only from the terminal that opened it — and writes the review's
localhost and tailnet links for your status line for as long as it lives.

## Install

```
/plugin install plannotator-tailnet --marketplace thangnguyen-69/claude-mods
```

Answer `y` to `Add marketplace?`, then choose the user scope to load it in every
session. `plannotator` and `tailscale` are both needed — see
[Requirements](#requirements).

## What it does

Plannotator binds its review UI to a random loopback port and opens
`http://localhost:<port>`, which nothing but this machine can reach. This mod
watches `plannotator sessions --json` every 4 seconds and, for every live
session **this Claude session started**, runs:

```
tailscale serve --bg --https=<port + 1000> http://127.0.0.1:<port>
```

The review is then open at `https://<host>.<tailnet>.ts.net:<port + 1000>` —
tailnet only, never public. When a Plannotator review is opened through the
tool, the URL is toasted as well.

### Why the tailnet port is not the review's own port

`tailscale serve --https=<port>` cannot take a port another process binds on
`0.0.0.0`, and Plannotator binds `0.0.0.0:<port>` unless it was started with
`PLANNOTATOR_REMOTE=0` — which is not this mod's to choose, because the review
is opened by Plannotator's own tool. The reservation then fails **silently**:
`tailscale serve status` still prints the mapping, so `serve` exits 0 and the
URL looks published while every `https` request to it dies with
`wrong version number`.

Measured 2026-10-25 on the author's machine:

| backing bind | served on | tailnet answer |
| --- | --- | --- |
| `0.0.0.0:<p>` | `<p>` | **000** |
| `127.0.0.1:<p>` | `<p>` | 200 |
| `0.0.0.0:<p>` | `<p>+1000` | **200** |

A port of its own is therefore the only arrangement that works whichever way
the review happened to bind.

### A link is only shown once it answers

The same silent failure means `tailscale serve status` is not evidence a URL
loads. Every tailnet link is fetched first and is written to the hint line and
the status file only when the request answers; a reservation that does not is
taken down and republished on the next sync. Any HTTP status counts — a `403`
from Plannotator's Host allowlist is a live listener just like a `200`. A
refusal by the host's own fetch policy reads as unreachable, so the link is
withheld rather than guessed at: the localhost link is always still there.

## Hint line

While a review of this session's is live, the newest one is drawn on the hint
line under the prompt — `review` and a link carrying the tailnet URL when the
port is published and answers, the loopback URL otherwise. Nothing is drawn
when no review is live. This needs no settings entry and no per-machine script:
it installs with the plugin.

It is drawn by a `ui.render` hook on `PromptHint`, beside the engine's own hint
rather than replacing it — that tree carries the key hints and pills, and
dropping it would trade one useful line for another.

An earlier version wrote the links to a JSON file and left a `statusLine`
command to draw it. That could not work on its own: a plugin **cannot** ship a
`statusLine` key (the manifest rejects it as an unknown field) and `$.settings`
is read-only, so every install needed a hand-written command plus this machine's
session-id path.

## The status file, for a statusLine command

The mod still keeps `~/.claude/plannotator-tailnet/<session id>.json` up to
date, so a `statusLine` command of your own can draw the same links:

```json
[{ "label": "115515 (review)", "local": "http://localhost:33919", "tailnet": "https://<host>.<tailnet>.ts.net:34919/" }]
```

`tailnet` is present only while `tailscale serve` publishes the port **and the
listener answers**; the list is empty once no review is live. Read it with the
`session_id` stdin gives you:

```bash
f="$HOME/.claude/plannotator-tailnet/${session_id}.json"
jq -r '.[] | [.label, .local, (.tailnet // "")] | @tsv' "$f" 2>/dev/null |
while IFS=$'\t' read -r label local tailnet; do
  printf '%s \033]8;;%s\033\\localhost\033]8;;\033\\' "$label" "$local"
  [ -n "$tailnet" ] && printf ' \033]8;;%s\033\\tailnet\033]8;;\033\\' "$tailnet"
  printf '\n'
done
```

## Only this session's own reviews

Plannotator's `sessions/` registry is machine-wide, so a mod reading it sees
every concurrent review on the box — another Claude session's, a colleague's
over an SSH session, one started from a shell. Publishing and displaying all of
them is wrong: each session would show links to reviews that are not its own.

A session tells its own apart by `PLANNOTATOR_SESSION_TAG`
(`claude-code:<session id>`), which Plannotator's own mod writes into the
session's environment and which the registry records as `hostSession`. A review
with no tag — started from a shell, or by a host that tags nothing — is
nobody's here, and is left exactly as it was found.

Publishing is per review. Plannotator picks a fresh port each session, so
nothing is ever reassigned underneath a review already in progress, and the
tailnet port moves with it.

## What it will not touch

- Another session's review, and any review nothing tagged.
- A port already serving something else: left alone, reported as skipped. Only a
  mapping this mod published is ever removed, and only while it still points
  where the mod put it. That includes the tailnet port it would have used — it
  is *derived* (`<review port> + 1000`), not chosen, so it can be one the person
  already serves something on.
- Ports below 1024, and 443 (which would collide with the person's own HTTPS
  listener), are never published — and neither is a review whose derived tailnet
  port would land past 65535.

## The Host allowlist

`tailscale serve` forwards the browser's own `Host:
<machine>.<tailnet>.ts.net`, which a Plannotator server's Host allowlist refuses
with `403 host_not_allowed` unless the name is listed in
`PLANNOTATOR_ALLOWED_HOSTS`. The variable is read once, when a server starts, so
it is set in two places:

- `~/.claude/settings.json`'s `env` block — the reliable half: it reaches every
  Plannotator surface, including servers started before any hook runs, and
  survives a Plannotator upgrade. `*` turns the check off entirely.
- `session.start` here, which lists this machine's MagicDNS name and nothing
  else — the precise half, for a machine whose `settings.json` has no entry. A
  value that already names the machine, or that is `*`, is left as it is.

## Command

| Command | Effect |
| --- | --- |
| `/plannotator-tailnet` | Sync now and list this session's live reviews and their tailnet URLs |
| `/plannotator-tailnet off` | Unpublish this session's mappings |

## Requirements

- `plannotator` on `PATH` or at `~/.local/bin/plannotator`.
- `tailscale serve`, with the user configured as the tailscale operator (no sudo
  needed in that case).

## Loading it

The mod runs in every session without a flag: its folder is named in
`CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`. That
key is read from the user's settings only (never a project's), alongside the
process environment, and each named folder loads exactly as `--plugin-dir` does.

For a one-off session instead: `claude --plugin-dir <this folder>`.

While a session hot-reloads the folder, saving a file reloads the hooks module;
`claude plugin validate .` and `claude plugin test .` check it from the CLI.

From a fresh clone `.claude-plugin/types/` is empty: the engine writes the type
contracts when the mod first loads, so load it once before `tsc -p .` has
anything to check against.

## Plan review (ExitPlanMode) — not blocked by this mod

A plan review published here can be approved from a phone, and the approval does
reach the agent. Two things are worth knowing before blaming this mod for an
agent that "cannot escape plan mode":

- Plannotator's mod answers `ExitPlanMode` itself with a **deny** — *"Plan v1 is
  open… It is NOT approved. Stay in plan mode… The user's decision will arrive
  as a message"* — so the tool returning an error is the design, not a failure.
  Escape needs a **second** `ExitPlanMode` after the approval is stored
  (matched by plan hash in plannotator's own store, then allowed through its
  `classic.PermissionRequest` hook).
- The turn telling the agent to retry is delivered by `$.prompt.submit`, which
  lands once the agent is **idle** — so approving while the agent is mid-turn
  looks exactly like a wedge until it next yields. Measured 2026-10-11: the
  approval was written, the message queued within a second, and it arrived only
  after the turn ended. Nothing is lost, and an agent that calls `ExitPlanMode`
  again unprompted escapes sooner — that pass consumes the approval and makes
  the later message stale, so a late delivery needs no action.

This mod cannot cause it: it registers no hook that can gate `ExitPlanMode`
(its tool matcher is `mcp__plannotator__plannotator`, and matchers are exact),
no `tool.check`, no `classic.PermissionRequest`. It never denies, never returns
with `next` pending, and a failing render hook fails open — the permission
dialog is drawn by the engine alone.

The approve POST is Host-allowlist guarded, which is the one real hazard: see
"The Host allowlist" above. Since the plan server starts on the first
`ExitPlanMode` — after `session.start` — the mod's own write is early enough on
a machine with no `settings.json` entry, but a tailnet Approve to a session that
somehow started without it fails `403` and is **silently swallowed**: the review
looks healthy, no decision is written, and the agent waits.

## Design notes

- The sync is serialised behind one queue: the timer, the tool call and the
  command never read `tailscale serve status` at the same time, and each caller
  gets its own report.
- Mappings are recorded per session (`published:<session id>`), so a session
  only ever tears down its own. A session that ends with a review still open
  cannot tidy up after it — the review outlives it — so the entry stands, and
  whichever session runs next reaps it once the review is gone too.
- The claim that a review is this session's is the registry's to make, read
  afresh every sync: `/clear` starts a new session id in the same process with
  no `session.start` to hear it, and the review the old id opened must not
  follow the new one.
- The status file is rewritten only when its content changes, and holds only
  this session's reviews, so the status line never shows another session's.
- A failed lookup of the `plannotator` binary is retried on the next Plannotator
  tool call, so a mod that started before the binary resolved does not stay
  broken.
