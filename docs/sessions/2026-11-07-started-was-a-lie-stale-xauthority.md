# "Started" was a lie: a stale XAUTHORITY after the session crash

**Date:** 2026-11-07 · **Versions:** `vr-quest` 0.5.5 → 0.5.6

## The report

Right after the session crash, the user ran `vr-immersed` twice:

```
Wi-Fi 'HUY THINH APARTMENT': profile 'workstation' already active.
Started Immersed agent: /home/thang/.local/opt/immersed/Immersed-x86_64.AppImage
Headset not on USB/adb; open Immersed on the headset yourself and press Connect.
```

Both times, there was no process. "Started" was reporting a fork, not a running agent.

## Where the cause actually was

`~/.Immersed/Logs/2026_11_07 00-20-25-901.txt` was **9 lines** and ended at `Encoder Factory` — which
reads like a normal startup that simply had no headset yet. The truth was one file over, in
`~/.local/state/immersed-launch.log`:

```
Authorization required, but no authorization protocol specified
```

The shell's `XAUTHORITY` was `/run/user/1000/.mutter-Xwaylandauth.PIW0X3`, inherited from the session
that had just crashed. The replacement Xwayland had started with a **different** file — `.7ZY8X3`.
Same uid, same path shape, different name. Immersed could not open the display and segfaulted
immediately.

This is a post-crash variant of a trap the skill already documents. What it did not say is that the
*diagnostic* splits across two files, and that the app log is the one that looks healthy:
**a launch that yields a tiny log and no process means read the launch log, not the app log.**

## Two segfault signatures, and only one is dangerous

This failure's segfault was:

```
Immersed[1174560]: segfault at e0 ... in Immersed[4c5fe8,...]
```

— the same address as the 2026-11-02 crash. Neither killed the session: no virtual monitor was live,
`GNOME Shell crashed` count was **0**, and gnome-shell kept its pid. Compare with the session-killer:

| | harmless | kills the session |
|---|---|---|
| segfault site | `Immersed[4c5fe8]` | `libwayland-client+0x6fb4` |
| `Meta-*` monitors live | no | **yes** |
| follows with | nothing | `Removed virtual monitor` → Mutter assertion → signal 6 |

So **a segfault in this app is not by itself evidence of the crash path.** Check for live `Meta-*`
monitors, and check whether `Removed virtual monitor` follows it. That is the discriminator the
previous session established, and it held here against a real second data point.

## The fix

`vr-immersed` was inheriting `XAUTHORITY` from whatever shell called it, which is exactly how the
stale value propagates. It now:

- derives the auth path from the **live Xwayland for this uid** (`pgrep -af Xwayland` → the `-auth`
  argument), falling back to the inherited `XAUTHORITY` only if that yields nothing readable;
- **verifies the process 3 s after launch** rather than printing "Started" for a process that already
  died, and on failure prints the launch-log tail plus the live `-auth` path.

Verified with the stale value still exported: the resolver returns `.7ZY8X3`, not `.PIW0X3`.

## Lesson worth keeping

The script's original sin was not the missing auth handling — it was **reporting success it had not
checked**. A three-second `pgrep` after launch would have surfaced this on the first attempt instead of
the third. Any "started X" line in these scripts should be backed by a check that X is running.
