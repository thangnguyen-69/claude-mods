---
name: vr-setup
description: "Set up and debug a Linux VR desktop on a Meta Quest: Immersed VR, or the free open-source WiVRn + WayVR stack. Use when the user says /vr-setup, asks to install or configure Immersed, wants virtual displays, extra monitors, a portrait or ultra-wide/high VR screen, needs the monitors arranged or positioned, reports VR screens stuck/frozen/laggy, that a virtual display won't change resolution, that Immersed is not updating or needs a restart, that GNOME Displays shows monitors overlapping, or that a VR session died. Also use for WiVRn or WayVR: installing them, a Quest that will not connect over USB (adb unauthorized), WayVR showing black or nothing, hand tracking or the wrist watch not working, opening apps or a terminal inside VR, typing into VR apps with the physical keyboard (Super+Z), recentering, or avoiding a VR subscription. Also use when VR panels lose their positions or the user wants the screen layout remembered. Also covers the scripts vr-layout, vr-diag, vr-diag-watch, vr-start, vr-reconnect, vr-ready, vr-workspace, vr-term, spotify-vr, chrome-vr, vr-fix and vr-hand-bindings."
---

# VR setup — Meta Quest desktop on Linux (Immersed, or WiVRn + WayVR)

## Pick the stack first

| | **Immersed** (this file, §1–8) | **WiVRn + WayVR** → read [`wivrn-wayvr.md`](wivrn-wayvr.md) |
|---|---|---|
| Cost | free tier; paid ~$5–6/mo for more screens | free, open source, no account |
| Model | real extra **virtual monitors** (GNOME Wayland) | app **panels** in VR + optional monitor mirror |
| Hands | polished (poke, grab) | ray + pinch after `vr-hand-bindings` |
| Established on | Ubuntu 24.04, AMD 780M | Fedora 42, Intel UHD (T14 Gen 4) |

If the user is on WiVRn/WayVR, mentions those names, or wants no subscription, use
`wivrn-wayvr.md`; the Immersed sections below don't apply to it. Both stacks share a Quest + adb.

Everything in the Immersed sections was established empirically on Ubuntu 24.04.5, GNOME Shell 46 /
Mutter 46.2, Wayland, AMD Radeon 780M (Phoenix iGPU), Meta Quest 3. Where something is unverified
it says so.

## Install the helper scripts first

The scripts live in `scripts/` next to this file. Copy the ones for your stack onto `PATH`.
Look before overwriting: if a same-named script already exists in `~/.local/bin`, diff it first.

```bash
SKILL_DIR="<this skill's base directory>"     # the folder containing this SKILL.md
# Immersed
for f in vr-layout vr-diag vr-diag-watch; do install -Dm755 "$SKILL_DIR/scripts/$f" ~/.local/bin/$f; done
# WiVRn + WayVR
for f in wayvr vr-start vr-reconnect vr-ready vr-workspace vr-term alacritty-vr spotify-vr chrome-vr vr-fix vr-hand-bindings; do
  install -Dm755 "$SKILL_DIR/scripts/$f" ~/.local/bin/$f
done
```

The Immersed scripts need **system** `/usr/bin/python3` with `gi` (GObject introspection). A conda/pyenv python
usually has no `gi` — do not switch interpreters. The shebang already points at `/usr/bin/python3`.

## 1. Install Immersed

Per-user AppImage; no apt/flatpak/snap package is needed.

```bash
mkdir -p ~/.local/opt/immersed
cp Immersed-x86_64.AppImage ~/.local/opt/immersed/
chmod +x ~/.local/opt/immersed/Immersed-x86_64.AppImage
```

Desktop entry at `~/.local/share/applications/immersed.desktop`:

```ini
[Desktop Entry]
Type=Application
Name=Immersed
Comment=VR workspace for remote desktop sessions
Exec=/home/<user>/.local/opt/immersed/Immersed-x86_64.AppImage %U
Icon=immersed
Terminal=false
Categories=Network;
StartupWMClass=Immersed
```

Launch detached so it survives the shell:

```bash
setsid nohup ~/.local/opt/immersed/Immersed-x86_64.AppImage >/tmp/immersed-launch.log 2>&1 </dev/null &
```

**Requirements that are not optional:** a **Wayland/Mutter** session. Immersed creates virtual
displays by driving `org.gnome.Mutter.ScreenCast` + `org.gnome.Mutter.DisplayConfig` over D-Bus;
the Xorg session will not work.

### Expected noise on every launch — do not chase these

- `Failed to open uinput` — **not** a permissions problem. `/dev/uinput` is usually `0666`; the
  binary also references a device name `uinput-immersed` and the legacy `/dev/input/uinput`,
  which does not exist on modern hosts. Keyboard injection may fall back to X11 `XTest` through
  XWayland. (Fallback is a theory, not verified.)
- `Failed VIDIOC_G_FMT -1` — `CameraDevice` points at a real webcam, not a v4l2loopback device.
- `NVENC ... Unsupported` / no HEVC — correct on an AMD iGPU. VAAPI H.264 is the encoder.
- `Cannot find key for int curator-request` / `account_type` — harmless.

## 2. adb and USB

Only needed for sideloading, Quest-side `pm`/`am` work, and Immersed's **USB Wired Mode (BETA)**.
It is **not** needed for virtual displays.

```bash
sudo apt install android-sdk-platform-tools
```

`/etc/udev/rules.d/51-android.rules`:

```
SUBSYSTEM=="usb", ATTR{idVendor}=="2833", MODE="0666", GROUP="plugdev", SYMLINK+="android"
```

```bash
sudo udevadm control --reload-rules && sudo udevadm trigger
adb devices          # expect "unauthorized" until you accept the prompt in the headset
```

**Trap:** the adb server outlives the app that spawned it and caches permission failures. After
any udev/permission change, kill it explicitly (`pgrep -af 'adb -L' | awk '{print $1}' | xargs -r kill`)
or `adb devices` will keep lying. The server's parent is `systemd --user`, not Immersed, so
restarting Immersed does **not** refresh it.

**Always run `adb devices` before installing or repairing anything** — it has resolved itself
on its own before now.

## 3. Virtual displays

Config is `~/.ImmersedConf` (key=value; `Data=` and `VDData=` hold JSON blobs). Logs are
`~/.Immersed/Logs/<date time>.txt`.

`VDData.Displays` is a **fixed 4-slot array**:

```json
VDData={"Displays":["{\"Height\":1440,\"IsEnabled\":true,\"IsRotated\":true,\"Width\":2560}", ...]}
```

Each slot holds exactly four keys: `Width`, `Height`, `IsEnabled`, `IsRotated`. **There is no
position/offset field** — arrangement is not expressible in config (see §5).

Enable slots from Immersed's **Monitors → Configure Virtual Displays** UI when it works. When the
Monitor tab is empty (a known defect), edit the file by hand:

**Order matters: Immersed rewrites `~/.ImmersedConf` on exit. Kill it FIRST.**

```bash
pkill -f '/usr/bin/Immersed'; sleep 3
cp -a ~/.ImmersedConf ~/.ImmersedConf.bak-$(date +%H%M%S)
```

The blob stores an extra escaping layer, so in raw bytes slot 0 reads `\\"Width\\":1920}` (two
backslashes). Do a **byte-level targeted replace of exactly one occurrence**; do not parse and
re-serialise the whole file (`json.loads` on the raw line fails, and reformatting risks
corrupting other keys):

```python
p = "/home/<user>/.ImmersedConf"
s = open(p, "rb").read()
old, new = rb'\\"Width\\":1920}', rb'\\"Width\\":3440}'
assert s.count(old) == 1
open(p, "wb").write(s.replace(old, new, 1))
```

Then relaunch Immersed.

## 4. Portrait / vertical screens ("ultra high")

Store the **native landscape** mode and flip the flag — do not store portrait numbers directly:

```
Width: 2560, Height: 1440, IsRotated: true     →  displayed as 1440x2560
```

Verified: log shows `New capture size: 1440 2560`, capture line `1440 x 2560`, encoder
`H264 VAAPI 1440x2560`. `IsRotated` appears once per slot; replace only the target slot's
occurrence when hand-editing.

**Sizing vocabulary:** 3440x1440 is ultra-*wide*; ultra-*high* means tall — portrait.

## 5. Arrangement — two different coordinate spaces

Mutter's layout and the headset's spatial layout are **not** the same thing.

- **In VR:** Immersed computes positions and pushes them to the headset
  (`Did Receive Display Origin Change`, e.g. `Index: 1 x:-1440 y:-740`). Arrange by dragging
  screens in the **VR UI**; the config cannot store it.
- **On the Linux side:** Mutter reports its own logical layout, and Immersed rebuilds it from
  slot order (each screen starting at the previous one's right edge).

### Forcing the Linux-side layout via D-Bus

`vr-layout apply` does this. Four traps, each of which cost a failed attempt:

1. `ApplyMonitorsConfig` signature is `(uua(iiduba(ssa{sv}))a{sv})`. The inner monitor is
   `a(ssa{sv})` = `(connector, MODE_NAME, props)` — the second string is the **mode name**
   (`1440x2560@60.000`), **not** the product name. A product name yields
   `InvalidArgs: Invalid mode '...' specified`.
2. `GetCurrentState` and `ApplyMonitorsConfig` use **different** logical-monitor structs:
   `a(iiduba(ssss)a{sv})` for reading, `a(iiduba(ssa{sv}))` for writing.
3. **Negative positions are rejected**: `Invalid logical monitor position (-1440, 0)`. Mutter 46
   requires the positive quadrant, so a screen can never sit left of x=0. To place something
   "left of the primary" you must move the primary right instead.
4. `gdbus call` **cannot** parse the nested `a{sv}` in this signature. Use `/usr/bin/python3` +
   `gi.repository.Gio`/`GLib.Variant` + `bus.call_sync`.

### THE BUG: never move the primary display

Moving the primary (`DP-1`) away from x=0 corrupts Immersed's capture offsets. Measured:

```
10:09:21  Screen0 (0,0) 1920x1080 | Screen1 (1920,0) 1440x2560 | Screen2 (3360,0)
10:11:26  Screen0 (0,0) 1920x1080 | Screen1 (0,0)    1440x2560 | Screen2 (3360,0)
                 (primary moved to x=1440; Screen1 should read (1440,0) — it reads (0,0))
```

Both streams then capture **overlapping regions**, and the primary screen's VR stream appears
frozen while the untouched third screen keeps working. Immersed holds a fixed capture rectangle
per stream and does not rebuild it when Mutter's layout changes.

**Consequences:**

- Safe: `DP-1` stays at x=0, portrait at x=1920, third screen at x=3360.
- Unsafe: portrait at x=0 with `DP-1` moved to x=1440.
- Negative x is impossible (see trap 3), so "portrait left of the primary" cannot be achieved
  without hitting the bug.

**Untested avenue:** apply the moved-primary layout and then reconnect the headset, so Immersed
rebuilds its ScreenCast streams. If the new streams pick up the new offsets, the left position
may become usable.

`vr-layout` snapshots live in `~/.config/vr-layouts/`. `restore` only accepts timestamped
snapshots (`layout-YYYYmmdd-HHMMSS.json`); named layouts such as `layout-desired-*.json` are
`apply only` and deliberately unreachable by `restore`, so the emergency command can never
re-apply the layout you are escaping. Keep that restriction if you edit the script.

Layout is **not durable**: Immersed re-applies its own config on every session change, so a
headset reconnect reverts it. Re-run `vr-layout apply` after each connect.

## 6. Diagnosing a frozen or stuck stream

**The `==== Screen Info ====` log block is ground truth**, emitted every 1–3 min. Read it before
touching anything.

```bash
L=$(ls -t ~/.Immersed/Logs/*.txt | head -1)
```

| Signal | Meaning |
|---|---|
| `New capture size: W H` | the ONLY proof a resolution change was applied |
| `FPS:1.01 Bitrate:0kbps` + `Capture - Not Running` | genuine dead stream |
| `TotalFrame`/`TotalBytes` not advancing across two blocks | genuine stall |
| all screens at `(0, 0)` | layout collapsed (dead session, not a config fault) |
| `received key frame request for N` repeated | headset asking for a usable frame |

**Bitrate alone is NOT a stall indicator.** Tens of kbps is normal for a mostly-idle desktop;
a healthy working stream measured 52 kbps. Two diagnoses were made wrongly on this assumption.
Compare `TotalFrame` and `TotalBytes` across two blocks **and confirm the block timestamp is
newer than the event you are reasoning about** — blocks repeat, so a stale block silently
returns old numbers.

### Tooling

```bash
vr-diag                    # one-shot snapshot, prints a summary
vr-diag --label before     # tag it
vr-diag --list
vr-diag --compare A.json B.json
vr-diag-watch start 30     # background sampler
vr-diag-watch hang         # IMMEDIATE snapshot — press the moment it freezes
vr-diag-watch stop|status
```

Snapshots go to `~/.local/state/vr-diag/`. The decisive data is a **before/after/during-hang**
triple on the same session, with timestamps, so correlation is not mistaken for cause.

Caveat: `vr-diag`'s `pgrep -f '/usr/bin/Immersed'` can match transient helper processes, so the
recorded `immersed_pid` is unreliable. The stable process is what
`ps -eo pid,lstart,cmd | grep Immersed` shows.

### Transport facts (so you don't chase the network)

- Video travels over the **USB cable** via adb port-forward: `adb reverse --list` shows
  `UsbFfs tcp:21000` (control) and `UsbFfs tcp:21013` (stream). The loopback sockets on
  21000/21013 ARE the video path — do not dismiss them as local plumbing.
- There is no socket to the Quest's LAN IP and no cloud relay for video; DigitalOcean/CloudFront
  connections are account/API traffic.
- The tunnel is not a bottleneck: during a stall `send-q=0`, `retrans: 0/113`, sub-10ms RTT.
- Current hosts negotiate **USB 2.0 at 480 Mb/s**. A USB 3 port/cable gives more headroom.

## 7. Restarting Immersed

A restart rebuilds a stuck session. **The user must press Connect in the headset afterwards** —
the headset does not rejoin on its own.

```bash
pkill -f '/usr/bin/Immersed'; sleep 4
pgrep -af 'adb -L' | awk '{print $1}' | xargs -r kill
setsid nohup ~/.local/opt/immersed/Immersed-x86_64.AppImage >/tmp/immersed-launch.log 2>&1 </dev/null &
```

Then wait for a `Started screen cast session` line and, after the user connects, a fresh
`Screen Info` block.

## 8. Sizing and performance

Lag is **capture-bound**, not link-bound or encode-bound. Measured on a 780M:

| Config | Total pixels | Capture fps (phys / portrait / 720p) |
|---|---|---|
| 1920x1080 + 3440x1440 + 1280x720 | ~9.2 MP | 47.4 / 40.0 / 51.4 |
| 1920x1080 + 1440x2560 + 1280x720 | ~6.7 MP | 55.9 / 53.1 / 58.9 |

Encode stayed ~56–60 fps in both — so when capture fps drops on **all** screens, it is total-pixel
pressure on the iGPU, not one bad display. Attack order: drop the third screen first (biggest win),
then lower the largest resolution. Check `vcn_busy_percent` (100 = encoder saturated) and system
swap/load average — a full swap file plus high load causes **input** lag easily mistaken for
display lag.

Rough suitability on this class of GPU: 2560x1080 comfortable, 3440x1440 workable, 5120x1440 a
stretch, 4K (~8.3 MP) at the limit. Immersed drops fps with more screens (`FPS:60`,
`FPSFor2:60`, `FPSFor4:30`). Bitrate caps are `LocalMaxBitrate:16000` / `RemoteMaxBitrate:8000`;
raising `LocalMaxBitrate` is the free quality win.

## Honesty rules

- Do not state a maximum resolution. `MaximumScreenPixel` / `MaximumScreenWidth/Height` are
  runtime settings; their values are not readable from the binary.
- Do not claim the headset reconnects by itself — it does not.
- Do not claim a `ApplyMonitorsConfig` layout survives a reconnect — it does not.
- Do not use bitrate as proof of a freeze.
- Before asserting a cause, line up event timestamps: `journalctl --user --since` for exact
  seconds, and re-read a `Screen Info` block only if its timestamp is newer than the change.
  Several wrong diagnoses were made by skipping this.
