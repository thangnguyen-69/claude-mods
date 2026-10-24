---
name: spawn-teammate
description: "Spawn one teammate — a named Claude Code session in a new herdr pane with a specified name and prompt — via the implement-beads plugin's spawn-teammate.sh. Triggers: 'spawn a teammate', 'spawn an agent', 'start a helper/worker session', 'give this task to a separate pane'."
---

# spawn-teammate

Spawn ONE teammate: a named Claude session in a new terminal pane, with a
specified name and a specified prompt. The script lives in the sibling
`implement-beads` skill: `<this skill's base directory>/../implement-beads/scripts/spawn-teammate.sh`
(call it `SPAWN` below; use the absolute path).

```bash
SPAWN --name <name> --prompt "<first turn>" \
    [--prompt-file <path>] [--cwd <dir>] [--direction right|down] [--model <model>] [--report-to <session>]
```

- Prints `TEAMMATE <name> SESSION <name> PANE <id>` — the name is the address
  for follow-up `SendMessage`s.
- `--prompt` is the teammate's first turn (delivered by the script, no SendMessage
  handoff needed). Omit for an idle teammate. `--prompt-file` for long prompts.
  Multi-line prompts (including every `--prompt-file`) cannot travel
  through argv — herdr's agent-start encoder rejects newline-containing arguments.
  The script works around it by writing the prompt to a temp file and passing claude a
  one-line pointer ("Read the file … and do what it says."); the output includes
  `PROMPT_FILE <path>` so the coordinator knows where the task text landed.
  NOTE: a rejected `agent start` can still leave the pane + agent alive from a
  partially-successful attempt — check `herdr agent list` before retrying with the
  same name.
- `--model` picks the teammate's model (alias `opus`/`sonnet`/`haiku` or a full model id),
  passed to claude as `--model`. Omit for the default. When the user names a model, pass it
  here — do not leave it to the prompt.
- `--report-to <session>` appends a standard footer telling the teammate to report back to
  that session via `SendMessage`. Use your own name from `ListAgents` ("This process's main
  session is …"). Needs a non-empty prompt.
- `--close <name>` closes that teammate's pane (`herdr agent get <name>` → `herdr pane close`).
  Prints `CLOSED <name> PANE <id>`; exits 1 for an unknown name.
- The pane gets `TEAMMATE_NAME=<name>` so hooks can tell which teammate they run for
  (e.g. the `implement-beads` plugin's `implementer-no-bead-close.sh`).
- `--cwd` defaults to the workspace root (`BEADS_WORKSPACE`, else the git top level), never a
  subfolder — spawned panes inherit cwd, including any subfolder's own settings.
- herdr only: run from inside a herdr session (`HERDR_ENV=1`), otherwise it exits 2.
  Name rule: herdr's `[a-z][a-z0-9_-]{0,31}`, unique among live agents.
- Cleanup: `SPAWN --close <name>`, or `herdr pane close <pane_id>` — never kill/pkill the pane's
  claude process.
