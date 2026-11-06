# Zero stutter costs you the custom layout

**Date:** 2026-11-06 · **Versions:** `vr-quest` 0.5.3 → 0.5.4

## The report

*"we now know that the stutter only happens if we don't have zero copy buffer, so now update the skill
to have 0 stutter, accept the tradeoff that we can't customize layout."*

Correct, and 0.5.0 had already recorded the fact — but only as a caveat. It was still written as
"anything that breaks zero-copy is a thing to be careful about", with the rest of the file (sections 5,
12, 13) still instructing the reader to `vr-layout apply` to fix a layout. A skill that says "don't do
X" in one section and "do X" in three others will get X done to it.

The rewrite makes it the **goal statement** instead: zero stutter is what we optimise for, and the
Linux-side layout is the price.

## The mechanism, verified rather than assumed

Mutter 46 picks the capture buffer type from a single property, in
`src/backends/meta-screen-cast-stream-src.c`:

```c
prop_modifier = spa_pod_find_prop (format, NULL, SPA_FORMAT_VIDEO_modifier);
if (prop_modifier)
  buffer_types = 1 << SPA_DATA_DmaBuf;
else
  buffer_types = 1 << SPA_DATA_MemFd;
```

`dataType` is a bitmask over `spa_data_type` (`MemPtr`=1, `MemFd`=2, `DmaBuf`=3 → **4** and **8**), so
the negotiation is readable from both ends. `pw-dump` is JSON; the script extracts it rather than
grepping, because `"dataType": {` spans lines.

## The part that stopped this being a simple best-practice write-up

**On the AMD host, zero-copy is not recoverable — it was never negotiated.**

| Side | `dataType` | Meaning |
|---|---|---|
| gnome-shell (producer) | `4` | MemFd only |
| Immersed (consumer) | `6` | MemPtr \| MemFd |

No DmaBuf bit on either side. The process held **16** `mutter-screen-cast-memfd` fds and **0** dmabuf
fds. Mutter *did* advertise DMA-BUF format modifiers on its `EnumFormat` and still fixed on MemFd.

So the honest framing is two-mode, not one-mode:

- **hosts that negotiate DMA-BUF** → zero-copy is achievable, protect it, the tradeoff is real;
- **hosts that never do** → the copy is structural, `vr-immersed --restart` fixes nothing, and the
  older `(0,0)` guidance is still the best available.

Writing only the first version would have produced advice that fails silently on the user's own
machine. The skill now says to read `vr-stats`' `zero-copy:` line before promising anything.

`vr-stats` itself needed a fix here: a fresh process with memfd-only buffers fell through to
`zero-copy: unknown (no DMA-BUF buffers seen yet)`, which is the *wrong* reading — it is not "wait and
see", it is "the negotiation did not offer it". It now prints `zero-copy: NOT IN USE` with the memfd
count.

## Why the tradeoff write-up matters more than the fix

The rule is only half the work; the other half is refusing to offer the broken remedy. That means:

- the ordered remedy list for stutter explicitly says **do not add `vr-layout apply` to this list**;
- `vr-layout apply` is scoped to the pre-connect window everywhere it appears, with the one safe
  ordering stated (apply, *then* connect);
- the layout watcher's "re-apply on every Connect" is named as exactly the renegotiation that breaks
  zero-copy, rather than described neutrally.

## Also fixed while in here

A duplicated `### Quest-side decoder: NO_MEMORY` heading in section 13 — the second one's body was
actually the "not the cause" bullets. Pre-existing, mislabelled, and it would have sent a reader
looking for decoder logs that were not there.
