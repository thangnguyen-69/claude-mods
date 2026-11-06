# Profile selection now falls back to the machine

**Date:** 2026-11-07 · **Versions:** `vr-quest` 0.5.9 → 0.6.0

## The report

*"can we make it zero copy? my laptop can do 0 copy on fedora. go with A"*

Two asks. A — host-keyed profile selection — is what this change implements. The zero-copy question
is separate and still open; it is summarised at the end because the two were asked together.

## Why A was worth doing

Auto-selection was Wi-Fi-only. Measured on this host before the change:

```
on this Wi-Fi   -> workstation
on Ethernet     -> (nothing)
on an unlinked SSID -> (nothing)
```

`current_ssid` is blank on Ethernet, so `profile_for_ssid` returned empty and `vr-immersed` started the
agent with whatever `~/.ImmersedConf` already held. Not broken — the previous `--save`/apply is still
there — but unpredictable, and invisible: nothing was printed to say no profile had been applied.

The codebase was already half per-machine: `vr-layout` keys layouts as
`~/.config/vr-layouts/hosts/<hostname>/<NAME>.json`, with the comment "Two PCs never share a layout:
connector names (`eDP-1` vs `DP-1`) and panel sizes differ." Profiles were the inconsistent half.

## What changed

Lookup order, most specific first:

| # | Rule | File |
|---|---|---|
| 1 | current SSID, linked on this machine | `hosts/<hostname>/places` |
| 2 | current SSID, linked for all machines | `immersed/places` |
| 3 | this machine's default, the `HOST=` line | `hosts/<hostname>/places` |
| 4 | nothing | — |

Wi-Fi deliberately stays more specific than the machine, so a laptop can behave differently at home
and in the office. Rule 3 is the part that fixes Ethernet.

New `vr-immersed --link-host NAME` writes the `HOST=` line; `--link` now writes the **per-host**
places file (falling back to the shared one for reading, so existing installs keep working);
`--list` prints all three groups and states the order.

## Two bugs found while implementing

1. **SSID prefix collision.** The old lookup was `grep -F -- "$ssid="`, so a network named `Home`
   would match a line for `Home 2` (and the reverse). Replaced with an exact key comparison over the
   file. Covered by test cases G and H below.
2. **Silent no-match.** With no rule matching, the script printed nothing at all. It now names the
   situation and the command that fixes it.

## Verification

`bash -n` clean. Lookup logic exercised in a sandbox against real-format files, all 8 cases as
expected:

```
A) shared SSID link, on that Wi-Fi     -> workstation
B) Ethernet, no HOST line              -> (empty)
C) unknown SSID, no HOST line          -> (empty)
D) Ethernet, HOST=workstation          -> workstation
E) unknown SSID, HOST=workstation      -> workstation
F) per-host SSID link beats shared     -> override
G) ssid "Home" vs line "Home 2=x"      -> workstation   (no false match)
H) ssid "Home" vs line "Home=override" -> override
```

`--link-host` tested in a throwaway `$HOME`: writes `HOST=<profile>`, is idempotent (re-running does
not append a second line), exits 2 with usage when no name is given and 1 for an unknown profile.
Re-linking an existing SSID replaces its line rather than appending. `--list` output verified.

The running agent was not touched — no `pkill`, no `vr-immersed` start, no layout apply. A mid-session
layout change is the session-crash path from §11, so the sandbox is the only way this should be tested.

## Still open: zero-copy on this host

Unchanged and outside this change. The evidence says it is not reachable here:

| | value | meaning |
|---|---|---|
| Mutter producer `dataType` | `4` | MemFd only — no `DmaBuf` bit (8) |
| Immersed consumer `dataType` | `6` | MemPtr\|MemFd — no `DmaBuf` bit |
| Immersed fd count | 0 dmabuf / 16 memfd | frames are copied through RAM |
| `kDmaBufMinVersion` in the binary | **3.24** (corrected) | Immersed imposes no blocking version gate; PipeWire 1.0.5 satisfies it |

Mutter 46 chooses the buffer type from whether the negotiated format carries a `modifier` property,
and it *does* advertise DMA-BUF modifiers here — yet still fixates on `dataType: 4`. That discrepancy
is the loose end: it is **not** the PipeWire version (1.0.5 clears all three gates) and **not** an
Immersed version gate. **Corrected 2026-11-07: it is not the compositor either.** Mutter 48's
`meta-screen-cast-stream-src.c` has byte-identical buffer-type logic to 46 (`prop_modifier ?
1 << SPA_DATA_DmaBuf : 1 << SPA_DATA_MemFd`), and the AppImage here is unpatched (`sha256sum` matches
the pristine `~/Downloads` copy, so the HEVC patch is not in play). Immersed's capture path does link
the DMA-BUF code — `StartScreenCastStream` constructs `EglDmaBuf` and calls `QueryDmaBufModifiers`,
`ProcessBuffer` calls `ImageFromDmaBuf` — so this is a **runtime decline** in the app, not a missing
capability. Where it declines is not yet known: a `LIBGL_DEBUG=verbose MESA_DEBUG=1` relaunch confirmed
the debug env reached the process, but EGL does not initialise at `Screen count is 0`, so it produced
nothing. The probe needs a connected headset to run.
