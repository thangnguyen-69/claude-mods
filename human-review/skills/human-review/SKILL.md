---
name: human-review
description: "Run a review loop with the human in Plannotator until they click Approve: open the change as a diff review, post its localhost and tailnet links, triage every annotation with a verdict (no code changed yet), put the verdicts back to them as one-click questions, apply exactly what they chose, verify, push, and reopen the review on the same base — round after round. Use whenever the user says /human-review, 'review with me via plannotator', 'iterate until I approve', 'open the changes again', 'let me review the PR on my phone', or hands over a PR/branch/worktree to review together, even if they don't name the skill."
---

# human-review

A review loop between you and the human, with Plannotator as the shared surface.
The human reads and decides; you triage, change, verify and reopen. The loop ends
only when they click **Approve** in a diff review.

```
open diff review ──> links ──> [human annotates] ──> verdicts.md (one question per finding)
      ^                                                        │
      │                                                  [human answers]
      └── close stale review <── push <── verify <── apply only the chosen fixes
                    [human approves the diff] ──> record it, stop
```

Two rules make this loop worth having:

- **No code changes between an annotation and its decision.** An annotation is a
  question or a suspicion, not an instruction. You inspect, give a verdict, and
  the human decides. The Plannotator feedback says so too.
- **Every decision is a choice the human clicked, with its scope spelled out.**
  A one-line chat reply like "go with X" leaves the scope open: just the line
  they marked, the function, or the whole file? Putting each verdict to them as
  a `:::question` whose options name the scope removes the guess. It also lets
  them run the whole loop from a phone.

## Requirements

- The `plannotator` tool (Plannotator's Claude Code mod). This skill only calls
  the tool. Don't start a CLI server: it would be a second, untracked session.
- Optional: the `plannotator-tailnet` mod from this marketplace. It publishes
  every review this session opens on the tailnet. Without it, you post only the
  localhost link.
- Git. You need a local checkout to push fixes, so even a hosted pull request
  is reviewed from a local worktree.
- `python3`, for the bundled `scripts/review-link.sh`.

`SCRIPTS` below is the `scripts/` folder next to this SKILL.md: the skill's base
directory, printed when the skill loads, plus `/scripts`.

If the `plannotator` tool is missing or a call to it errors, stop and tell the
human what failed. Don't fall back to the CLI: a server the tool didn't open is
one the tool can't list or close, and its result never comes back as a message.

## 1. Resolve the target, once

Work out three things and keep them for every round:

- **Directory**: the worktree that holds the change. For a PR URL, find the local
  checkout of its source branch (an existing worktree first, else check it out).
- **Base**: what the diff is compared against.
  - For a PR, run `git fetch origin <target>` first, then use
    `git merge-base origin/<target> HEAD`. That is the commit the PR's diff is
    computed from, even when the branch is behind its target.
  - For a stacked branch, use the branch below it, so the human sees only this
    layer.
  - With no PR, use the repo's default branch.
  - `options.base` takes a ref or a sha. Use the sha, so the base can't move
    between rounds.
- **Head check**: the local HEAD must equal what is pushed (`git status -sb` shows
  no ahead/behind, and HEAD matches the PR's source commit). Otherwise the human
  would review something other than what the PR holds. Fix that first, or say
  why you can't.

Plannotator opens GitHub/GitLab/Bitbucket PR URLs itself. That mode reviews the
remote diff only, though, and this loop pushes fixes, so use the worktree plus
the base every time.

## 2. Open a round

1. Call `plannotator` with `action: "review"`, `target: <directory>` and
   `options.base: <base>`. Note the session id (`pn-...`) and the localhost URL
   it returns.
2. Get the tailnet link: run `SCRIPTS/review-link.sh <localhost URL>`.
   - It reads the status file `plannotator-tailnet` writes for this session and
     waits up to about 15 seconds while the mod publishes.
   - Exit 0: the tailnet URL is on stdout.
   - Exit 1: nothing on stdout, which means there's no tailnet link (mod not
     installed, tailscale down, or not published yet).
   - The verdicts file in step 4 is a review of its own, with its own `pn-` id
     and localhost URL. Get its links the same way.

3. Post both links on their own lines: the tailnet one first, then localhost. Add
   one line on what the diff covers: commits, and the base by name and short sha.
   If no tailnet link appeared, post localhost and say plainly that the tailnet
   link isn't up yet (mod not installed, or still publishing). Never post a
   guessed link.
4. **End your turn.** The decision arrives later as a message that starts with
   `Plannotator:` and names the review's `pn-` id. That holds for the diff review
   and for the verdicts file alike. Match the id to the review you have open this
   round before acting on the message. Do not poll, and do not reopen.

## 3. When the diff review comes back

Classify the result only by its decision, never by the wording of the message.

- **approved**, including approved with notes: go to step 6, and change no
  code. What the human approved is this head commit; any change after Approve
  would ship something they didn't see. Treat notes as follow-ups: list them,
  and offer to file them.
- **dismissed / closed with nothing sent**: don't reopen on your own. Ask whether
  they're done or want it reopened.
- **annotated**: triage, as follows.

For each finding, and only the findings sent (don't widen the review):

- Read the code at the line, plus enough around it to judge.
- Run `git blame -L <line>,<line>` to see whether the base or this change
  introduced the line. Say which: "introduced by <sha>" or "pre-existing".
- If the comment points to a spec, plan or ticket, read it and quote the part that
  decides the point.
- Give one verdict: **Confirmed**, **Partly**, **Not a bug**, or **Intended /
  deliberate scope**. Back it with one or two sentences of evidence: file:line,
  what the code does, and what the spec says.
- Work out the concrete fix for a confirmed or partly-confirmed finding. Name its
  scope exactly: which symbols, how many call sites, whether output changes, and
  whether a test or golden would move.

Change no code during triage.

## 4. Put the verdicts to the human

Write the verdicts to a markdown file in your scratchpad, or a temp dir if
there's none. Name it `<repo>-round-<n>-verdicts.md`. Use one `:::question` block
per finding; Plannotator renders these as one-click choices:

```markdown
# Round 2 verdicts — <branch> vs <base>

:::question
L93 `class Row(...)` — "better naming please": rename the review's row/group types?

Confirmed, introduced by 75d9827. `Row`/`Group` don't say what they hold;
`_RowBase` exists only because `total=False` makes every key optional. Rename
touches 6 types, 14 annotations, no output change.

- [ ] Rename now: VulnRow, VulnGroup, GroupCve, FalconCarry — types only, goldens unchanged
- [ ] Rename now and drop the base classes via NotRequired — needs Python ≥ 3.11 on the agents
- [ ] Follow-up change, not this one
- [ ] Leave as is

Recommended: Rename now: VulnRow, VulnGroup, GroupCve, FalconCarry — types only, goldens unchanged
:::
```

- Make each question self-contained. The human switches in cold, often on a
  phone, so include the quoted comment, the verdict, the evidence, and what the
  fix costs.
- Every option states its scope, so any answer is unambiguous. Always offer
  "follow-up, not this change" and "leave as is".
- For a **Not a bug** or **Intended** verdict, still ask: the first option is to
  agree and leave it, the second to change it anyway.

Then open the file with `plannotator` `action: "annotate"` and
`target: <verdicts file>`, and post its links as in step 2. Send a short chat
message alongside with one line per finding (verdict + recommendation), so the
terminal shows the gist too. End your turn.

## 5. Apply what they chose

The answers arrive as the verdicts review's `Plannotator:` message. Under each
question you get `Answer: <choice>`, `Other: …`, a quoted free-text reply, or
`Skipped`. If the verdicts review is still open once the answers are in, close
it.

- Apply exactly the chosen options, at the scope the option named. A "Skipped"
  or "Leave as is" means leave it alone. If an `Other:` answer still leaves the
  scope unclear, don't guess: carry that one into the next round as a new
  question, and go ahead with the rest.
- Verify, comparing against the state before your change:
  - Run the tests.
  - Run any golden or snapshot outputs, and confirm they're unchanged unless the
    fix was meant to change them.
  - Run linters and type checkers. Record the error count before your change,
    and introduce no new ones.
  - Confirm the diff touches only what was decided.
- Commit with the repo's conventions (message style, ticket tag, trailers), then
  push to the same branch. A human who started a review loop on a pushed branch
  is asking for the fixes on that branch. If the branch isn't pushed yet, or is
  someone else's, ask before pushing.
- Close the old review with `plannotator` `action: "close"` and its `pn-` id, so
  only one live review shows. Then reopen the round as in step 2, on the same
  directory and base. Say what changed: the new commit(s), and the findings each
  one settles.

## 6. On Approve

- Say it in one line: what was approved, the head commit, and the PR link.
- If the project tracks work in beads (`bd`) and a bead owns this change, add a
  note to it with `bd note <id> "..."`. Include the approved head sha, the PR's
  full URL, and the open follow-ups the human chose. Don't close the bead, and
  don't merge. Both stay with the human.
- If a follow-up was chosen during the rounds and the project uses beads, offer
  to file it. Don't file it silently.
- Close any review still open from this loop (for example a verdicts file).
- Stop.

## Keep the human oriented

- One live review at a time from this loop: the diff or a verdicts file, never
  two stale diffs.
- Every round message has the same shape: links, what this round covers, what
  changed since the last one.
- Point to things by their full URL (PRs, builds) and by file:line.
