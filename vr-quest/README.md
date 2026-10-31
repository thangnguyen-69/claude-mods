# vr-quest

Claude Code mod for **Immersed VR + a Meta Quest on GNOME/Wayland**. It packages the setup and
the debugging knowledge from a long session on Ubuntu 24.04 (GNOME 46 / Mutter 46.2, AMD Radeon
780M, Quest 3) so a fresh machine can be brought up without rediscovering the traps.

## Install

```
/plugin install vr-quest --marketplace thangnguyen-69/claude-mods
```

Then say `/vr-setup`, or describe the problem ("my VR screen is frozen", "add a portrait
display", "the monitors are arranged wrong").

## What is in here

```
vr-quest/
  .claude-plugin/plugin.json
  skills/vr-setup/
    SKILL.md            # the whole procedure, plus the traps
    scripts/
      vr-layout         # save / apply / restore the Mutter monitor layout
      vr-diag           # one-shot diagnostic snapshot (+ --compare)
      vr-diag-watch     # background sampler; `hang` = immediate capture
```

The three scripts are installed onto `PATH` as part of setup (see SKILL.md step 0).

## Requirements

- **Wayland / Mutter.** Not Xorg — Immersed creates virtual displays through Mutter's D-Bus API.
- `python3` with **`gi`** (GObject introspection). Use `/usr/bin/python3`; conda/pyenv pythons
  usually lack it.
- `adb` + the `2833` udev rule, only if you want wired mode or sideloading.
- The Immersed AppImage (`Immersed-x86_64.AppImage`).

## The two things most worth knowing

1. **Never move the primary display off x=0.** Doing so corrupts Immersed's capture offsets and
   the primary screen's VR stream freezes while other screens keep working. Negative positions are
   rejected by Mutter, so "portrait left of the primary" is not safely achievable.
2. **Bitrate is not a stall signal.** Tens of kbps is normal for an idle desktop. Compare
   `TotalFrame`/`TotalBytes` between two `Screen Info` blocks, and check the block timestamp is
   newer than the event.

## Licence

MIT, matching the rest of this repository.
