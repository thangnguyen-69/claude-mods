# The hint line that drew one review and would not say which

**Date:** 2026-10-25 · **Plugin:** `plannotator-tailnet` (not yet changed)

## The report

`sire`, after `pr-links` was fixed to draw every link: *"does our plannotator
plugin have same problem?"*

Yes — and the same shape of defect, in a place with one less excuse for it.

## The defect

`hooks/register.tsx:425`:

```ts
const newest = entries[0] ?? null
```

Everything else in the module is plural. `sync` builds a `StatusEntry` for every
live review of this session's, `writeStatus` writes the whole list to
`~/.claude/plannotator-tailnet/<session id>.json`, and the README documents that
file for anyone's `statusLine` command. Only the hint line collapses it:

```tsx
<Link href={hint.tailnet ?? hint.local} label={hint.tailnet === undefined ? 'local' : 'tailnet'} />
```

Two separate problems, and the second is the worse one:

1. **No count.** `pr-links` 0.1.0 drew the newest plus `+4`. This draws the
   newest and says nothing, so a second live review is invisible with no hint
   that it exists.
2. **The label does not name the review.** It says `tailnet` or `local` — the
   transport. `StatusEntry.label` already holds `<project> (<mode>)` from
   Plannotator's own session list, and is written to the status file for exactly
   that purpose, but the hint line never reads it. A person with two reviews open
   cannot tell which one the link opens, which defeats the link.

The label was chosen deliberately, and the comment says why: "a `Link` with no
label draws the whole URL as its text, which for a tailnet URL is longer than the
rest of the line put together." That reasoning is sound about *bare URLs* and
wrong about the fix — the answer is a short label that names the review, not a
short label that names the transport.

## What the fix looks like

Draw every live entry, each labelled `<project> · tailnet` (or `· local`), so
both facts survive. Where several are live, the transport can also be implied by
which URL the link carries — but a person reading a wrapped line needs the word.

Tests at `tests/register.test.ts:371` and `:399` assert the literal labels
`tailnet` and `local`; both would change.

## The reason this matters more here than in pr-links

A PR link is decorative — you can find the PR. A review link is *the only way
into that browser session*, and Plannotator's own `sessions` list is not where a
person looks mid-task. Showing one of several, unlabelled, means the others are
reachable only by remembering a port number.

## Not done

The change was not made. Sire asked for the diagnosis and for the PR reviews to
be opened; the plugin edit was offered and is waiting on a word.

## Unrelated, but hit while opening the reviews

Plannotator in remote mode binds a **fixed** port 19432, so a second concurrent
review refuses with "port 19432 is already in use". Another session (a
landing-page review, pid 3043055) held it, and the `plannotator` MCP tool
therefore could not open any of the eight PR reviews. The other session's review
was left alone — killing it would discard its unsent annotations — and each
review was given `PLANNOTATOR_PORT=1956x` instead.

Consequence worth remembering: **the MCP tool cannot open concurrent sessions in
this setup; the CLI with `PLANNOTATOR_PORT` can.**
