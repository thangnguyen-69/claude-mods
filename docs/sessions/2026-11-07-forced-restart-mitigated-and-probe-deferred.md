# Two results from one forced restart: a mitigation, and a probe that could not run

**Date:** 2026-11-07 · **Versions:** `vr-quest` 0.6.1 → 0.6.2

## Why the test happened

After correcting the zero-copy diagnosis (0.6.1), the open question was *where* Immersed declines
DMA-BUF. It links the whole path — `StartScreenCastStream` builds `EglDmaBuf` and calls
`QueryDmaBufModifiers`, `ProcessBuffer` calls `ImageFromDmaBuf` — but logs nothing about the decision.
The proposed probe was a restart with `LIBGL_DEBUG=verbose MESA_DEBUG=1`.

That restart is the documented session-crash path (§11), so it was held back twice. The user then
closed their applications and said to go ahead despite both `Meta-*` monitors still being live.

## Result 1 (unexpected): the session survived

```
01:01:36 gnome-shell[1135703]: Removed virtual monitor Meta-0
01:01:36 gnome-shell[1135703]: Removed virtual monitor Meta-1
```

No segfault. No `GNOME Shell crashed`. **Same gnome-shell pid afterwards.** The earlier two
occurrences — 2026-11-03 and 2026-11-07 00:06 — both aborted on signal 6 at the assertion.

The difference was an empty desktop. So **teardown of the virtual monitors is not sufficient** to
trigger `meta_window_get_work_area_for_logical_monitor: assertion failed: (logical_monitor)`. Something
asks for a work area on a monitor that has just vanished, and that something walks windows — most
plausibly Tiling Assistant's `tilingWindowManager.js:1303` → `:437` → `:99`, the frames in the
recorded stack. With no windows, there was nothing to walk.

Practical consequence, now in §11: **close applications before restarting Immersed with virtual
monitors live.** That is a genuine mitigation, not merely data-loss hygiene.

Caveat kept in the text: this is one controlled data point and the mechanism is unproven.

## Result 2: the probe never ran

The debug environment did reach the process — verified on the live pid via `/proc/<pid>/environ`:

```
LIBGL_DEBUG=verbose   MESA_DEBUG=1   EGL_LOG_LEVEL=debug
```

But `grep -ic egl` on the new app log returned **0**, and the log showed `Screen count is 0`. EGL is
not initialised until a stream exists, so there was no DMA-BUF negotiation to observe.

The 0-dmabuf-fd reading taken afterwards is equally uninformative: with no stream there are no capture
buffers of either kind. Reporting "still not zero-copy" from that sample would have been meaningless —
the same trap as reading capture fps on an idle desktop.

**The probe needs the headset connected.** Deferred until then; nothing in the skill claims a result.

## Method note

The first version of the test script waited for `Meta-*` to disappear before killing anything — correct
for the unforced case. It was rewritten (rather than sed-patched, which mangled the loop on the first
attempt) to take a `FORCE=1` flag, and run under `setsid` so that if the session did abort, the
experiment's log would outlive it. That last part turned out unnecessary, but it was the right
protection for a test whose failure mode is "the shell that would read the log is gone".
