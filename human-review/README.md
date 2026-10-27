# human-review

`/human-review` runs a review loop between you and Claude, with
[Plannotator](https://github.com/backnotprop/plannotator) as the shared surface,
until you click **Approve**:

1. Claude opens the change as a Plannotator diff review against the right base
   (the PR's target, or the branch below a stacked one), with a Mermaid diagram
   of the flow it touches next to it, and posts the links.
2. You annotate the diff.
3. Claude triages every annotation, without touching code: a verdict per finding
   (Confirmed / Partly / Not a bug / Intended), evidence, whether this change or
   the base introduced the line (`git blame`), and what the fix would cost.
4. The verdicts come back to you as a Plannotator page with one question per
   finding. Each option names its scope exactly, so you answer with a click
   instead of a one-liner that leaves the scope open.
5. Claude applies exactly what you chose, then verifies: tests, goldens, and no
   new linter errors. It commits, pushes to the same branch, closes the stale
   review and reopens the diff on the same base.
6. On Approve, it records the result (a `bd note` when the project uses beads)
   and stops. Merging stays with you.

## Install

```
/plugin install human-review --marketplace thangnguyen-69/claude-mods
```

## Requirements

- Plannotator's Claude Code mod, which provides the `plannotator` tool.
- Recommended: [`plannotator-tailnet`](../plannotator-tailnet), so every round
  also comes with a tailnet link and the loop works from a phone. Without it,
  only the localhost link is posted.
- A local git checkout of the change. Hosted PRs are reviewed from their local
  worktree, because the loop pushes fixes.
