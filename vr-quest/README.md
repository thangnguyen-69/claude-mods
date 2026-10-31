# vr-quest

Claude Code mod for a **Meta Quest VR desktop on Linux**, with two stacks:

- **Immersed VR** on GNOME/Wayland: from a long session on Ubuntu 24.04 (GNOME 46 / Mutter 46.2,
  AMD Radeon 780M, Quest 3).
- **WiVRn + WayVR**, free and open source with no subscription: from a session on Fedora 42
  (GNOME Wayland, Intel UHD, Quest 3). See `skills/vr-setup/wivrn-wayvr.md`.

It packages the setup and debugging knowledge so a fresh machine can be brought up without
rediscovering the traps.

## Install

```
/plugin install vr-quest --marketplace thangnguyen-69/claude-mods
```

Then say `/vr-setup`, or describe the problem ("my VR screen is frozen", "add a portrait
display", "the monitors are arranged wrong", "WayVR is black", "open a terminal in VR",
"hand tracking doesn't work").

## What is in here

```
vr-quest/
  .claude-plugin/plugin.json
  skills/vr-setup/
    SKILL.md            # stack picker + the Immersed procedure and traps
    wivrn-wayvr.md      # the WiVRn + WayVR procedure and traps
    scripts/
      vr-immersed       # Immersed: start the agent + open Immersed on the Quest over USB
      vr-layout         # Immersed: save / apply / restore the Mutter monitor layout
      vr-diag           # Immersed: one-shot diagnostic snapshot (+ --compare)
      vr-diag-watch     # Immersed: background sampler; `hang` = immediate capture
      wayvr             # WayVR wrapper: libopenvr path + newest standalone binary
      vr-start          # cold start: WiVRn server, fresh WayVR, USB or Wi-Fi
      vr-reconnect      # rejoin over USB, keeping apps open in VR
      vr-ready          # wait until WayVR answers (running + headset worn)
      vr-workspace      # open your app list once each; they return to saved spots
      vr-term           # open a tall large-font terminal inside VR
      alacritty-vr      # Alacritty with a VR-sized font
      spotify-vr        # Spotify forced onto Wayland so it opens in VR
      chrome-vr         # Chrome on a separate VR profile so it opens in VR
      vr-fix            # WayVR hung/black: restart it, reopen the workspace
      vr-hand-bindings  # Quest hand tracking that acts like controllers
```

The scripts are installed onto `PATH` as part of setup (see SKILL.md, "Install the helper
scripts first").

## Requirements

WiVRn + WayVR: the WiVRn Flatpak (same version as the headset app), the WayVR standalone
binary + `wayvrctl`, Valve's `libopenvr_api.so`, `adb` for USB, Alacritty for `vr-term`, and the
`input` group for physical-keyboard capture. Details in `wivrn-wayvr.md`.

Immersed:

- **Wayland / Mutter.** Not Xorg — Immersed creates virtual displays through Mutter's D-Bus API.
- `python3` with **`gi`** (GObject introspection). Use `/usr/bin/python3`; conda/pyenv pythons
  usually lack it.
- `adb` + the `2833` udev rule, only if you want wired mode or sideloading.
- The Immersed AppImage (`Immersed-x86_64.AppImage`).

## The things most worth knowing

WiVRn + WayVR:

- **WayVR hangs after the headset comes off**, so you see black when you put it back on. `vr-fix`
  recovers. WiVRn must launch WayVR with `--show`, or every panel starts hidden.
- **Layout is saved only on a clean exit or when leaving Edit mode.** Arrange panels in Edit
  mode (watch), leave it, and `vr-workspace` brings them back to those spots.
- **Super+Z grabs the keyboard but clears focus**: pinch-click a VR window after it, or your
  typing goes to the desktop.

Immersed:

1. **Never move the primary display off x=0.** Doing so corrupts Immersed's capture offsets and
   the primary screen's VR stream freezes while other screens keep working. Negative positions are
   rejected by Mutter, so put screens left of the laptop **in VR** (swap/drag) instead. Never script
   monitor off/on toggles while Immersed streams: it segfaulted gnome-shell once.
2. **Bitrate is not a stall signal.** Tens of kbps is normal for an idle desktop. Compare
   `TotalFrame`/`TotalBytes` between two `Screen Info` blocks, and check the block timestamp is
   newer than the event.

## Licence

MIT, matching the rest of this repository.
