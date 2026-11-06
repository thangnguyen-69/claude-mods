# Immersed asks EGL about DMA-BUF before it initialises EGL

**Date:** 2026-11-07 · **Versions:** `vr-quest` 0.6.4 → 0.7.0

## What was known

Immersed negotiates `dataType: 6` (MemPtr|MemFd) with Mutter, so Mutter — correctly, per its own rule —
hands over MemFd buffers and every frame is copied through RAM. Three explanations had already been
retracted (0.6.1), and the GPU had been ruled out (0.6.3): EGL advertises the exact modifier Mutter
offers (`0x020000001046bb04` = Mutter's `alt1`). The remaining lead was the `Buffers` pod construction.

## The disassembly, and what it did not show

The binary is **not stripped** (82,598 symbols, `BuildFormat` and friends named), but its `.debug_*`
sections are ~100-byte stubs, so there is no line info: `addr2line` returns `??:?`.

`objdump` on `StartScreenCastStream` (0x4ded30) established:

- `pw_get_library_version()` → `ParsePipeWireVersion()` → compared against
  `kDmaBufModifierMinVersion` (0.3.33) plus a second gate, `AND`ed, and the branch to
  `EglDmaBuf::QueryDmaBufModifiers` is taken. Runtime string here is `"1.0.5"`.
- `EglDmaBuf`'s ctor `dlopen`s `libEGL.so.1` and resolves entries via `eglGetProcAddress`, logging
  `Unable to load EGL entry functions.` on failure.
- Building the same sequence by hand **succeeds**: all five entry points resolve,
  `eglGetPlatformDisplayEXT(EGL_PLATFORM_GBM_KHR, gbm_dev)` initialises on radeonsi, and
  `eglQueryDmaBufModifiersEXT(ARGB8888)` returns 6 modifiers led by Mutter's exact value.

So there was no wrong constant, no failed dlopen, no version gate. The `dataType` value never even
appears as an immediate — `BuildFormat` takes a modifier vector and produces the pod from it.

## The answer was in the log ordering, not the code

```
01:06:26.473  Started screen cast session      <- StartScreenCastStream / BuildFormat
01:06:26.474  Started screen cast session
01:06:26.490  Egl initialization succeeded     <- 16-17 ms later
01:06:26.494  PipeWire stream format changed   <- negotiation happens here
```

And the measurement that makes it decisive:

| display state | vendor | extensions | `EGL_EXT_image_dma_buf_import_modifiers` |
|---|---|---|---|
| `eglGetDisplay()`, no `eglInitialize` | `None` | **0** | **False** |
| after `eglInitialize` | `Mesa Project` | 41 | **True** |

**`eglQueryString(EGL_EXTENSIONS)` returns NULL before initialisation.** So the probe sees no
extensions, reports zero modifiers, and `BuildFormat` emits a format pod with no `modifier` property.
Mutter's `prop_modifier ? 1<<DmaBuf : 1<<MemFd` then chooses MemFd — correctly, given what it was told.

Immersed does not decline DMA-BUF. It never learns it exists.

## Why this fits every earlier observation

- The code path is linked and genuinely invoked — checked at instruction level.
- The identical EGL sequence works when driven in the right order — so nothing is broken.
- The driver advertises the exact value Mutter offers — so the GPU was never the limit.
- Nothing is logged, because an empty extension list is not an error.
- Per-host differences look like a **race**: the two operations are not sequenced, so a faster or
  luckier start may get `eglInitialize` in first. That predicts intermittency on a single host, which
  is consistent with zero-copy being reachable on other machines with the same build.

## The methodological near-miss

The first ordering test appeared to confirm the hypothesis — "0 extensions before init" — but it was
measuring the wrong thing: the shell had a stale `XAUTHORITY`, so `eglInitialize` returned `False` and
never initialised. The A/B only became valid after re-running with the live `-auth` path from
`pgrep -af Xwayland`. This is the second time in this investigation that a stale X auth produced a
confidently wrong reading; it is worth checking before trusting any EGL result driven from a shell.

## What is not established

Whether forcing the correct order actually yields zero-copy and removes the judder. Two candidate
routes, neither tested:

1. **Win the race** — nothing under our control, but if it is a race then a restart should occasionally
   land zero-copy. One command to test, and it would confirm the mechanism end-to-end.
2. **Patch** — run the probe after EGL init, or inject the modifier list into `BuildFormat`. Contained,
   but the HEVC patch precedent (changed host behaviour, bought nothing on the headset) argues for
   testing the cheap route first.
