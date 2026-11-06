# The session crash has a signature, and it is the teardown

**Date:** 2026-11-07 · **Versions:** `vr-quest` 0.5.4 → 0.5.5

## The report

The user ran `vr-immersed`, which applied the `workstation` profile and started the agent. Immersed
streamed normally for ~9 minutes — two screens, encoders pinned at 60 fps, `ScreenInfo` at 00:04:47
showing `(0,0) 3840x1440 @ 49.15` and `(3840,0) 1280x720 @ 58.2`. Then the whole GNOME session died.

The skill already said a restart with virtual displays live "can take the session down" (section 11),
based on one 2026-11-03 observation. What it did not have was the mechanism, or any way to tell when
it would happen. Both are now knowable.

## The chain, in ~80 ms

```
00:06:29.246  kernel: Immersed[1127518]: segfault at 40 ip ... in libwayland-client.so.0.22.0[6fb4,...]
00:06:29.246  systemd[1]: tmp-.mount_ImmerszUfZli.mount: Deactivated successfully
00:06:29.290  gnome-shell: D-Bus client with active sessions vanished
00:06:29.291  gnome-shell: Removed virtual monitor Meta-0
00:06:29.291  gnome-shell: Removed virtual monitor Meta-1
00:06:29.319  gnome-shell: libmutter:ERROR:../src/core/window.c:5957:
              meta_window_get_work_area_for_logical_monitor: assertion failed: (logical_monitor)
00:06:29.319  gnome-shell: GNOME Shell crashed with signal 6
00:06:29.319  #0 tilingWindowManager.js:99  <- #1 :1303  <- #2 :437
```

73 ms from segfault to abort. There is no window in which to intervene.

## The discriminator

This was the **third** Immersed segfault since 2026-10-25, and the second with this exact signature
(`libwayland-client+0x6fb4`, `segfault at 40`). The third one — 2026-11-02 22:33:06 — did **not** kill
the session:

| | 2026-11-02 (survived) | 2026-11-03 & 2026-11-07 (session died) |
|---|---|---|
| segfault | `Immersed+0x4c5fe8` | `libwayland-client+0x6fb4` |
| virtual display up? | **no** (`Expected Screen Count: 1`) | **yes** (`Meta-0/1/2` live) |
| shell outcome | same pid continues | `Removed virtual monitor` → assertion → signal 6 |

So the abort is **in the virtual-monitor teardown path**, not in the segfault. The assertion
`meta_window_get_work_area_for_logical_monitor` fails because the monitors are already gone by the
time Tiling Assistant asks for their work area (`:1303` → `:437` → `:99`).

That reframes the risk: **any** Immersed death while streaming carries it — crash, `pkill`, a profile
apply, a config rewrite — not only a deliberate restart.

## Two corrections to the skill's own text

1. **"There may be no kernel segfault line."** Wrong. `journalctl -k -b` still held all three
   segfault records after the session died. What vanishes is the dead session's `journalctl --user`
   output (0 records for the old shell pid). The forensics are inverted from what was written.
2. **`coredumpctl` "may be empty"** — it is not installed on this host at all. The old wording invites
   the user to run a command that does not exist.

## What changed in the tooling

`vr-immersed` applies a profile by `pkill`-ing Immersed, with no warning — which is precisely the
hazardous action. It now prints the cost before doing it.

The first version of that guard grepped `vr-layout show` for `Meta-`, which **false-positived
immediately**: the `desired:` block lists `Meta-0`/`Meta-1` even when the live layout is a single
`HDMI-1`. The guard now reads only the `CURRENT` section (`sed -n '1,/^desired:/p'`) and correctly
stays silent.

## Not established

Disabling Tiling Assistant is the obvious experiment and is **not** recommended as a fix — untested,
and this skill recommends that extension for VR tiling. The honest position is that the crash is
reproducible, its trigger is understood, and its removal is not.
