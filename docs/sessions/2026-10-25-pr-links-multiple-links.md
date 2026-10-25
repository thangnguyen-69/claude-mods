# The PR link that counted instead of showing

**Date:** 2026-10-25 · **Versions:** `pr-links` 0.1.0 → 0.2.0

## The report

`sire`, looking at the hint line during a run that had opened eight pull
requests: *"why +4 instead of pr-link showing all 4 links, plus would be great
if the format is not `PR #170` but `<repo-name> #170`"*.

Both observations were correct, and neither was a rendering accident.

## Cause 1 — one link plus a count, by design

`statusLink` returned only `state.links[0]` and an `older` count, which
`register.tsx` drew as `+4`. The band had been written for "the newest PR, and a
hint that older ones exist." Two things were wrong with that:

- **The count is the wrong information.** `+4` says four older pull requests
  exist; it does not say *which*. Knowing that four more links are hiding is not
  the same as being able to click the one you meant, and the whole point of
  keeping them was to be able to.
- **`MAX_KEPT` was 5.** Even drawing them all would have stopped at five, and
  the remainder fell off the end *silently* — a session that opened eight would
  look exactly like one that opened five.

## Cause 2 — the label threw away data the parser already had

`parsePrUrl` extracts `repo` as `<owner>/<repo>` for every forge shape, and
`parsePrUrl`'s own test asserts it. `statusLink` never read the field: it built
`PR #<number>` from `kind` and `number` only.

`PR #170` is ambiguous the moment a session works in two repositories, which is
routine in this setup — an infra repo and a landing-page repo produce `#170` in
each. Adding the repository is the smallest fix that disambiguates, and the owner
is left out because it is constant across an org and only lengthens the line.

## The fix

| before | after |
|---|---|
| `PR #170` + dim `+4` | `lumora-infra #170 · lumora-infra #169 · …` |
| newest only, `MAX_KEPT = 5` | every kept link drawn, `MAX_KEPT = 8` |
| overflow silently lost | dim `+N more` |
| label from `kind` + `number` | `<repo> #<number>`, falling back to the host |

`statusLink` (singular, one entry) became `statusLinks` (plural, all entries).
`mergeLinks` now returns `{ links, dropped }` instead of a bare array, so what did
not fit is announced rather than swallowed; `dropped` is also persisted in
`PrLinks` and taken as a running maximum, because a later command must not make
an earlier overflow look like it never happened. The stored-value shape check
tolerates an absent `dropped`, since a 0.1.0 value has no such field.

Links are drawn into a flat array rather than one `<>` fragment each: the render
tree is built from the engine's own elements, and `jsxFragmentFactory` is
`Fragment`, which this mod resolves nothing for.

## Verification

`tsc -p tsconfig.json` clean (the typecheck script the plugin's bundled
`claude-code` types provide). The suite could **not** be run here —
`claude-code/testing` resolves only inside the plugin dev harness — so
`format.ts`, where all of this logic lives, was exercised directly with `bun`:

| case | result |
|---|---|
| empty / hidden | `[]` |
| one GitHub PR | `lumora-infra #170` |
| two repos | `lumora-infra #167 · lumora-landingpage #12` |
| GitLab MR / Azure | `widgets #88` / `widgets #99` |
| no number in URL | repository name alone |
| no repo in URL | host, then number |
| 11 links | 8 kept, `dropped = 3`, last entry `+3 more` |

The unit tests were updated to match, including a new one for the overflow count.

## What this does not fix

The band is a single line. Eight links plus the engine's own key hints will wrap
or truncate in a narrow terminal — the honest limit is the terminal width, not
`MAX_KEPT`. A better shape, if it ever matters, is a second line or `/pr` listing
them; the count is a stopgap for that, not a solution.
