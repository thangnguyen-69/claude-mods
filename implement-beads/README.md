# implement-beads

Works through a [beads](https://github.com/gastownhall/beads) (`bd`) epic
unattended. For every ready bead, the orchestrator — your Claude session —
spawns a pair of teammates, each a named Claude session in its own herdr pane:

- `<short>-implementer` does the work, writes evidence into the bead, and hands
  off by labelling it `needs-judge`. It can never close the bead.
- `<short>-judge` wakes on that label, checks every acceptance criterion
  itself from primary evidence, and either passes the bead (`judge-pass`) or
  sends findings back. Only the judge reports PASS/FAIL to the orchestrator.

The bead is the shared state; the labels drive the handoff.

## Install

```
/plugin install implement-beads --marketplace thangnguyen-69/claude-mods
```

Then ask Claude to "implement the beads under `<epic-id>`" (or run
`/implement-beads`) from inside a herdr session.

## Requirements

- `bd`, with the workspace initialised (`.beads/`)
- herdr — the orchestrator must run inside a herdr session (`HERDR_ENV=1`)
- `jq`, `python3`, `bash`

## What is in here

| Path | What it does |
| --- | --- |
| `skills/implement-beads/SKILL.md` | The orchestrator's procedure: preflight, spawn, wait, close, final report |
| `skills/implement-beads/{implementer,judge}.tmpl.md` | The teammates' prompts |
| `skills/implement-beads/scripts/spawn-bead-pair.sh` | Preflights a bead, spawns the implementer, and starts a watcher that spawns the judge on `needs-judge`. `--list-ready <epic>` is a dry run; `--close` tears the pair down |
| `skills/implement-beads/scripts/spawn-teammate.sh` | Spawns one named Claude teammate in a herdr pane (also usable on its own, see the `spawn-teammate` skill) |
| `skills/implement-beads/scripts/wait-bead-label.sh` | Blocks until a bead carries a label; the judge's wake-up |
| `hooks/implementer-no-bead-close.sh` | PreToolUse guard: a session named `*-implementer` is denied `bd close`, `judge-pass` and the other ways to close a bead |

## Configuration

- **Workspace.** `bd` runs in `$BEADS_WORKSPACE`, else the nearest directory at
  or above the current one that holds `.beads/`. Teammates start there.
- **Workspace rules.** The prompts carry only generic limits (no merges, no
  pushes to the default branch, no gate bypass, no auth workarounds). Put your
  own in `<workspace>/.claude/implement-beads/implementer.extra.md` and
  `judge.extra.md` — which PR tool to use, which pipelines publish what, which
  environments may be applied to. They are appended to each prompt when present.
- **Per run.** `spawn-bead-pair.sh --context <path> --note "<text>"` adds
  context to both prompts for one pair.

## Environment the teammates get

`spawn-teammate.sh` exports `TEAMMATE_NAME=<name>` and
`ORCH_SESSION_ID=<orchestrator's CLAUDE_CODE_SESSION_ID>` into each pane (and
the same values as `OL_TEAMMATE_NAME` / `OL_ORCH_SESSION_ID` for older hooks).
The close guard reads the name; your own hooks can use either.

The guard is a guardrail against forgetting the rule, not a security boundary.
