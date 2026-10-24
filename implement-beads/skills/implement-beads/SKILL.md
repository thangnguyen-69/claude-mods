---
name: implement-beads
description: "Run beads unattended as implementer + judge teammate pairs: per bead, spawn `<short>-implementer` (does the work, labels the bead needs-judge, can never close it) and `<short>-judge` (waits for the label, verifies every acceptance criterion itself, on pass labels judge-pass (and closes only non-PR beads), sends findings back on fail, and is the only one that reports PASS/FAIL to the orchestrator). Triggers: implement these beads, run the epic overnight, long-running bead work, implementer/judge pair, 'work through bd ready unattended'."
---

# implement-beads

You are the **orchestrator**. For each bead you spawn one pair of teammates. Both read
the same bead. The bead is the shared state: the implementer writes progress and evidence
into it, the judge reads it, and the labels drive the handoff.

`SCRIPTS` below is the `scripts/` folder next to this SKILL.md (this skill's base directory,
printed when the skill loads, plus `/scripts`). Use its absolute path in every command.

```
implementer ──works──> bd note (evidence URLs) + bd label add needs-judge
judge (wait-bead-label.sh fires) ──verifies──┬─ pass: judge-pass (+ human, stays open if PR; close if no PR), SendMessage orchestrator "PASS"
                                             └─ fail: notes + SendMessage implementer findings, wait again
                                                (3rd fail: SendMessage orchestrator "FAIL" + HUMAN: ask bead)
orchestrator on PASS / FAIL ──> spawn-bead-pair.sh --close both panes
```

Only the judge talks to the orchestrator. The implementer never messages you.

## Requirements
- [beads](https://github.com/gastownhall/beads) (`bd`) with the workspace initialised (`.beads/`).
- herdr — run the orchestrator inside a herdr session (`HERDR_ENV=1`);
  `spawn-teammate.sh` exits 2 otherwise.
- `jq`, `python3`, `bash`.

## Enforcement already in place
- `hooks/implementer-no-bead-close.sh` (PreToolUse Bash, shipped with this plugin): a session whose
  `TEAMMATE_NAME` (or herdr agent name) ends in `-implementer` is denied `bd close`,
  `bd update --status closed`, `bd duplicate/supersede/delete`, `bd human respond/dismiss`,
  `bd todo done` and `bd label add … judge-pass`. `spawn-teammate.sh` exports `TEAMMATE_NAME`.
- `spawn-teammate.sh` also exports `ORCH_SESSION_ID` (your `CLAUDE_CODE_SESSION_ID`), so a
  hook in a teammate can attribute its work (PRs opened, say) to your session.
  Both are also exported as `OL_TEAMMATE_NAME` / `OL_ORCH_SESSION_ID` for older hooks.
- `SCRIPTS/wait-bead-label.sh <id> [label] [--max-wait s]` polls `bd show` every 10s.
  Exit codes: 0 label present, 3 bead closed, 4 timeout, 5 bd error (3 polls running), 2 usage.

## Workspace and per-workspace rules
The scripts run `bd` in the beads workspace: `$BEADS_WORKSPACE`, else the nearest directory at
or above the current one that holds `.beads/`. Teammates start there too.

The templates carry only generic hard limits. Rules specific to a workspace (which PR tool to
use, which pipelines publish what, which environments may be applied to) go in
`<workspace>/.claude/implement-beads/implementer.extra.md` and `judge.extra.md`. When present,
`spawn-bead-pair.sh` appends each one to that teammate's prompt under "Rules for this workspace".

## Step 1 — preflight (refuse rather than spawn a pair that can't be judged)
For each candidate bead (`bd show <id>`):
1. **Measurable acceptance criteria.** The bead's acceptance criteria (or a clearly
   labelled criteria list in the description) must be checkable within this run by
   someone who did not do the work: "PR published, CI build green, step X visible in run
   log", "`git grep foo` returns nothing on branch Y", a command + expected output.
   Not acceptable: "works", "improved", criteria needing days/weeks of observation
   ("30 days with no…", "7 nights in a row"), or none at all.
   → If missing or unmeasurable: **do not spawn**. List the bead and why, and ask the user
   (or, when unattended, file `bd create "HUMAN: write measurable acceptance criteria for <id>" -l human`
   and `bd dep <ask> --blocks <id>`).
2. Not blocked (`bd ready` / no open blockers), not already `needs-judge`/`judge-pass`.
   Not an epic, and not labelled `human`, `blocked_by_human`, `blocked-external` or `observe`:
   - `human` / `blocked_by_human`: waiting on a person (merge, permit, decision).
   - `blocked-external`: waiting on another team or ticket.
   - `observe`: criteria need a merge or time (nightly runs, 30 days); checked by hand later.
   **Stacked beads**: a bead that builds on another bead's *unmerged branch* carries
   `stack-on:<upstream-id>` instead of a blocking dep (a blocking dep would wait for the
   merge). It is ready only once every upstream has `judge-pass`. Use a real `bd dep` only
   when the upstream must merge first.
   Dry run for a whole epic (spawns nothing):
   `SCRIPTS/spawn-bead-pair.sh --list-ready <epic-id>` prints `OK` / `REFUSED <reason>`
   for every open bead under it.
3. Repo + worktree plan known (which repo, branch name). Two pairs must never share a
   repo branch or worktree.
4. Auth live for what the bead needs (cloud CLIs, VPN, API tokens). If not, stop and
   tell the user — do not spawn into a known auth failure.

Concurrency: keep about 3 pairs live; CI agent pools queue anyway.

**Beads that edit the same files.** Two beads on separate branches that touch the same
files produce conflicting PRs. Serialize them with `stack-on:<other-id>` before spawning,
and say in a `--note` which files each pair owns.

## Step 2 — spawn the pair (scripted)
Your own session name: call `ListAgents`. It is the header line ("This process's main session
is `<name>`", or "This session is `<name>`"). That name is `ORCH`. It can contain spaces,
so always pass it quoted: `--orch "the whole flow"`. Then, once per bead (after Step 1 passes):

```bash
SCRIPTS/spawn-bead-pair.sh <ID> --orch <ORCH> [--work <repo/worktree>] [--model <m>] [--context <file-or-dir>]... [--note "<text>"]...
```

The script derives the pair names (`proj-7a6o.13` → `bd-7a6o_13-implementer` / `-judge`;
short part ≤ 19 chars), re-checks the mechanical preflight (criteria present, not closed,
no `needs-judge`/`judge-pass`/`pair-running`), renders the prompts from `judge.tmpl.md` and
`implementer.tmpl.md` in this directory (plus the workspace's `*.extra.md`), spawns the
implementer (split right of your pane; no `--report-to`, it must not message you), adds
`pair-running`, and starts a detached shell watcher (`/tmp/bead-pair-<short>.watcher.{pid,log}`)
that waits for `needs-judge` and only then spawns the judge stacked below the implementer
(saves a whole idle Claude per pair). If the wait ends any other way (bead closed, 6h timeout,
bd error) the watcher still spawns the judge with that result in its prompt, so the judge
reports FAIL to you as usual. `--close` kills the watcher.
Both spawns are recorded in bead notes. Edit the templates (or the workspace's `*.extra.md`),
not the script, to change what teammates are told.
`--context` (repeatable, path must exist) and `--note` (repeatable free text) append an
"Extra context" block to *both* prompts; use them for per-run context.
Whether the criteria are *measurable* is still your call in Step 1.

**A missing judge pane is normal.** Until the implementer adds `needs-judge`, a live pair is
one implementer pane plus the watcher process (`/tmp/bead-pair-<short>.watcher.pid`). Never
close an implementer because no judge pane exists.

**Spawn errors.** `spawn-teammate.sh` carries on through herdr's
"timed out waiting for agent startup" once it sees claude running in the pane. In that case the
herdr agent name may stay unregistered, but the pane title is still the name, and `--close`
falls back to the title. If a spawn still ends without `WATCHER … PID`, check `herdr agent list`
and the bead's labels before doing anything else. Never re-run the spawn while the
implementer pane exists. The herdr name would collide, and two implementers would share a branch.
Instead, add the missing `pair-running` label and note by hand, and start the watcher from the
script's own watcher block.

## Step 3 — wait, then close the pair
Do nothing until a judge message arrives (no polling loop). On:
- `PASS <ID> …` — confirm with `bd show <ID>` that it has `judge-pass`. **Stay-open rule:**
  a bead whose deliverable is a PR stays open with `judge-pass` + `human` and
  `YOUR ACTION (human): review + merge <PR URL>` as the description's first line, until a
  human merges it (the human closes it, or the orchestrator does after confirming the merge).
  A bead with no PR is closed by the judge. Either way, then
  `spawn-bead-pair.sh <ID> --close` (closes both panes, drops `pair-running`),
  spawn the next bead's pair.
- `FAIL <ID> …` — close both panes the same way; the judge has already filed the `HUMAN:` ask bead.
  Move on to the next bead.
- Never close a bead the judge has not passed (a PR bead only after its merge is confirmed), and
  never overrule the judge silently; if you disagree, say so to the user.
- **Passed but not mergeable yet.** For example, the PR is stacked on an unmerged PR, or pins
  an unmerged upstream commit. Keep both `judge-pass` and `human`, so the user can review early.
  Line 2 of the description gives the merge order: what must merge first, and any re-point
  that is due after it. Remove `human` only when the PR itself needs agent work before anyone
  reviews it (merge conflicts, a stale base to rebase). Run that work as a new round, then
  restore `human`.
- **Merge status.** Re-check merge status with `git merge-tree --write-tree origin/<target> <head>`;
  a forge's cached mergeability can be stale.
- **Your own sweep.** On each check, look for human PR beads whose PR is merged. Close
  those (merge confirmed). The user may also leave "merged" as a bead comment.
- **FAIL that needs a decision, while the user is in the chat.** Ask with AskUserQuestion,
  record the answer on the judge's `HUMAN:` ask bead, and close that bead. Then put the
  decision into the bead's criteria or notes and re-spawn the pair. A bead the decision
  makes moot is closed as superseded.

## Step 3b — human review of PASSed PR beads
Offer the user a review of each PASSed PR (a review tool such as Plannotator, or the forge's
own diff view). Note the review link on the bead; the human card only shows the description.

The review feedback comes back to you, the orchestrator. Handle it like this:
1. Give a verdict per comment, with evidence. Say whether the gap is new in this PR or was
   deliberately left to another bead. Change no code until the user picks a route.
2. When a fix belongs in a bead that is already running, widen that bead's criteria. Tell its
   implementer with SendMessage.
3. When a PR is abandoned or re-scoped, take these steps:
   - move every `stack-on:<old>` label to the new upstream;
   - on downstream PR beads that carry the old PR's commits, remove `judge-pass` and `human`;
     they get rebased in a later round;
   - tell the live implementers.
4. Otherwise, clear `judge-pass` and `human`, add the feedback as criteria, and spawn a fresh
   pair on the same branch.

Never post AI-authored comments on the PR.

## Step 4 — when the run is done
After every PASS or FAIL, re-run `SCRIPTS/spawn-bead-pair.sh --list-ready <epic-id>`
and spawn pairs for the new `OK` beads (up to the concurrency cap). A judge-pass can unlock
`stack-on` beads, and a human merge or answer during the run can unblock others.

**Exit condition:** the helper prints 0 `OK` beads under the epic **and** no pair is live
(no bead under the epic is labelled `pair-running`). Never use raw `bd ready` reaching 0 as the
goal: it never does, because epics, PR beads parked with `judge-pass` + `human`, HUMAN asks and
`observe` beads all stay open.

Final report: every bead the run touched with PASS/FAIL and the judge's evidence URLs, then
what remains, grouped as:
- **Waiting on you**: `bd human list` (PR merges and asks).
- **Observe**: beads labelled `observe`.
- **Blocked**: the helper's `REFUSED … blocked` / `stacks on …` lines, with what they wait for.
- **FAILed**: beads whose judge sent FAIL, with the HUMAN ask each one filed.
