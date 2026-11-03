---
name: vr-setup
description: "Set up and debug a Linux VR desktop on a Meta Quest: Immersed VR, or the free open-source WiVRn + WayVR stack. Use when the user says /vr-setup, asks to install or configure Immersed, wants virtual displays, extra monitors, a portrait or ultra-wide/high VR screen, needs the monitors arranged or positioned, reports VR screens stuck/frozen/laggy, that a virtual display won't change resolution, that Immersed is not updating or needs a restart, that GNOME Displays shows monitors overlapping, or that a VR session died. Also use for WiVRn or WayVR: installing them, a Quest that will not connect over USB (adb unauthorized), WayVR showing black or nothing, hand tracking or the wrist watch not working, opening apps or a terminal inside VR, typing into VR apps with the physical keyboard (Super+Z), recentering, or avoiding a VR subscription. Also use when VR panels lose their positions or the user wants the screen layout remembered. Also use when WiVRn/WayVR wobbles or judders on a weak iGPU (switch to Immersed). Also covers the scripts vr-immersed, vr-layout, vr-diag, vr-diag-watch, vr-start, vr-reconnect, vr-ready, vr-workspace, vr-term, spotify-vr, chrome-vr, vr-fix and vr-hand-bindings."
---

# VR setup — Meta Quest desktop on Linux (Immersed, or WiVRn + WayVR)

## Pick the stack first

| | **Immersed** (this file, §1–8) | **WiVRn + WayVR** → read [`wivrn-wayvr.md`](wivrn-wayvr.md) |
|---|---|---|
| Cost | free tier; paid ~$5–6/mo for more screens | free, open source, no account |
| Model | real extra **virtual monitors** (GNOME Wayland) | app **panels** in VR + optional monitor mirror |
| Hands | polished (poke, grab) | ray + pinch after `vr-hand-bindings` |
| Established on | Ubuntu 24.04 AMD 780M; Fedora 42 Intel UHD | Fedora 42, Intel UHD (T14 Gen 4) |
| Who renders 3D | **the headset** (PC only captures + encodes flat screens) | **the PC** (both eyes, every frame) |
| Weak iGPU | head motion stays smooth; slow PC only slows screen content | panels wobble/judder when the PC misses frames |

**For text work on an integrated GPU, recommend Immersed.** Measured on an i5-1335U (Intel UHD):
WiVRn+WayVR held the render engine at 83–88% at ~1.2 GHz and panels wobbled; Immersed with three
screens used 31–42% at ~600 MHz and was "very still, very sharp" (see §8).

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
for f in vr-immersed vr-layout vr-diag vr-diag-watch; do install -Dm755 "$SKILL_DIR/scripts/$f" ~/.local/bin/$f; done
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

Day-to-day start: `vr-immersed` starts the agent if it isn't running, closes WiVRn on the
headset, and opens Immersed there over adb; the user then presses **Connect**.

**Per-place profiles:** `vr-immersed --save home` stores the current virtual-display slots
(`VDData`), `LocalMaxBitrate` and the capture FPS caps in `~/.config/vr-layouts/immersed/profiles/home.profile`;
`vr-immersed home` stops the agent (it rewrites its config on exit), patches only those
values into `~/.ImmersedConf` (backup first), and starts it — or skips the restart when that
profile is already active. Starting also turns the laptop **backlight** off (panel keeps running, so it still shows in VR;
saved brightness is never 0); `vr-immersed --stop` quits the agent and the headset app and turns
the screen back on; `--keep-screen` skips the backlight. `vr-immersed --link home` ties the current Wi-Fi SSID to the profile
(`~/.config/vr-layouts/immersed/places`, `SSID=profile` lines); plain `vr-immersed` then picks
the linked profile automatically and leaves the setup alone on unlinked networks. `--list` shows
profiles and links. VR screen
positions live on the headset and window-to-monitor placement can't be scripted on GNOME Wayland,
so neither is part of a profile. It finds the newest
`~/Applications/Immersed*.AppImage` — AppImageLauncher may have moved/renamed the file there
(e.g. `Immersed-x86_64_<hash>.AppImage`).

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
- **VR clicks/taps never reach the desktop on GNOME Wayland** (verified 2026-11-01, Linux agent
  build of Dec 2025). `Failed to open uinput.` is not a permissions problem: an LD_PRELOAD tracer
  showed the agent never calls `open()` on `/dev/uinput` at all, even with `/dev/uinput` at
  `root:input 0660` and the user in `input`. Disassembly of `InputEventWayland::reloadScreenSize`
  shows the uinput fd field is zeroed in the constructor and only checked (`fd <= 0` → log the
  error), never opened. Treat hand/controller clicking into the desktop as unsupported in this
  build; use the physical mouse/touchpad/keyboard. (WayVR does support pinch-click.)
  To trace the agent: AppImageLauncher's `binfmt-bypass` strips `LD_PRELOAD`, so extract the
  AppImage (`--appimage-extract`) and run `squashfs-root/AppRun` with the preload.
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

Re-confirmed 2026-10-31 on Fedora 42 / GNOME 48.8 / Intel UHD (laptop panel `eDP-1`): after
`vr-layout apply` put portrait at x=0, wide at x=1440 and `eDP-1` (primary) at x=4000, the next
`Screen Info` block showed the **virtual** screens' capture offsets following the move
(`(0, 0) 1440x2560`, `(1440, 0) 2560x1080`) but the physical screen still at `(0, 0)` — and the
laptop screen stopped updating in VR. So only the physical/primary capture is stale; virtual
screens can be rearranged freely as long as the physical one stays at (0,0).
`EnableAreaCapture=0` in `~/.ImmersedConf` does **not** fix it (tested the same day: the physical
capture still reported `(0, 0)` and froze). Why x>0 is unavoidable: Mutter's stage starts at (0,0),
so the leftmost monitor must sit at x=0 — "left of the laptop" always means moving the laptop right.
Workable answer: keep the physical screen at (0,0) and arrange screens by dragging them in VR
(Immersed stores VR positions relative to the physical screen and accepts negative ones there).

**Turning the physical monitor off, then on at the new position, rebuilds its capture — but it can
crash GNOME.** Observed 2026-10-31 (GNOME 48.8): with the laptop panel switched off and back on
(at 18:23, via GNOME Settings or Immersed — unclear which), Immersed created a fresh stream for it
at x=4000 and it worked; gnome-shell then logged ~400/min `Error blitting to screencast
framebuffer: cogl_framebuffer_blit premult mismatch`. A scripted repeat (restore, then off → on via
`ApplyMonitorsConfig` within seconds) **segfaulted gnome-shell** (`meta_monitor_mode_foreach_crtc`
← `sync_cursor_state`), logging the user out and killing every app. Do **not** script monitor
on/off toggles while Immersed is streaming. Safe options: keep the physical screen at (0,0) and
arrange in VR, or swap screens in Immersed's VR UI.

- Safe: `DP-1` stays at x=0, portrait at x=1920, third screen at x=3360.
- Unsafe: portrait at x=0 with `DP-1` moved to x=1440.
- Negative x is impossible (see trap 3), so "portrait left of the primary" cannot be achieved
  without hitting the bug.

**Untested avenue:** apply the moved-primary layout and then reconnect the headset, so Immersed
rebuilds its ScreenCast streams. If the new streams pick up the new offsets, the left position
may become usable.

The target layout comes from `~/.config/vr-layouts/desired.json` (a list of
`{"connector","x","y","primary"}`) when present, else the built-in `DP-1` example; connector names
differ per host (`vr-layout show` lists them). **Only newer copies of the script read that file — check
before trusting it.** The pre-2026-11-02 version ignores `desired.json` entirely (`DESIRED` hardcoded);
with it, `vr-layout apply` silently applies the built-in portrait-left layout and **moves the primary**,
which is the documented capture-corruption bug. Verify and refresh:

```bash
grep -c desired.json ~/.local/bin/vr-layout     # 0 = stale copy, do not run `apply`
diff ~/.local/bin/vr-layout <SKILL_DIR>/scripts/vr-layout    # small diff = safe to reinstall
install -Dm755 <SKILL_DIR>/scripts/vr-layout ~/.local/bin/vr-layout
```

This bit an operator on 2026-11-03: a hand-written `desired.json` was prepared for an alignment test
and would have been ignored, applying the primary-moving layout instead. Check `vr-layout show` — it
prints the `desired:` block it will actually use — **before** any `apply`.

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

**Two caveats learned the hard way — read §11 before running this.** A restart while virtual displays
are live can log the user out entirely (signal 6 in gnome-shell), and the launch line above inherits
whatever `XAUTHORITY` the calling shell has, which is wrong often enough to fail outright. Also check
that ports 21000/21003 actually released (`ss -tln | grep -E '2100[03]'`); `pgrep` alone can report
"stopped" while a survivor still holds the pairing port and the next launch dies with
`Setup PairingCode Server exception bind: Address already in use`.

## 8. Sizing and performance

**Known-good setup on a free account + Intel UHD (Fedora 42, 2026-10-31):**

| Screen | Resolution | Use |
|---|---|---|
| laptop panel `eDP-1` (primary, x=0) | 1920x1200 | Spotify / small apps |
| slot 0 virtual | 2560x1440 `IsRotated:true` → **1440x2560** | tall terminal |
| slot 1 virtual | **2560x1080** | Chrome |

`LocalMaxBitrate` raised 16000 → **40000** (USB link negotiated 480 Mb/s, so there is room);
keep the power profile on **performance** while in VR (`tuned-adm profile throughput-performance`):
measured on the same session, `balanced` dropped capture to 35–45 fps on all three screens and
performance restored 48–57 fps — capture (CPU + PipeWire threads), not the GPU, is what the
profile limits. Arrange left/right **in VR** (Immersed's screen swap / drag), never by moving `eDP-1`
in GNOME. A copy of the working config is worth keeping (`cp ~/.ImmersedConf <somewhere>`).

**Pixel budget on Intel UHD (i5-1335U), measured 2026-11-01, performance profile, AC power:**

| Screens | Total | Capture fps | Encoded fps |
|---|---|---|---|
| laptop 1920x1200 + 2x 1440x2560 | ~9.7 MP | 43–49 | **21–30** (choppy scrolling) |
| laptop 1920x1200 + 1x 1152x2048 (`2048x1152 IsRotated:true`) | ~4.7 MP | 52–54 | **60** |
| same, `balanced` profile | ~4.7 MP | 43 | 58–60 — and **77 → 66 °C**, fan 3985 → 3450 rpm |

Immersed CPU fell from ~2.5 to ~1.4 cores. Prefer one ~1152x2048 portrait screen over 1440x2560
ones on this class of iGPU; the headset can't resolve 1440 px across a normal-sized screen anyway.
With this lighter load `balanced` is the better trade (cool and quiet, content still ~43 fps);
use `performance` only for the heavy multi-screen setups.

**Cooling without losing the laptop screen in VR:** don't disable the panel (that removes it from
VR too); turn the backlight off instead — `busctl call org.freedesktop.login1
/org/freedesktop/login1/session/auto org.freedesktop.login1.Session SetBrightness ssu backlight
intel_backlight 0` (no root; brightness key restores). Capture FPS lives in `~/.ImmersedConf`
`Data` → `Capture` (`FPS`, `FPSFor2`, `FPSFor4`; edit with Immersed stopped); the log confirms
with `Set FPS - GPU: 45.000`. The cap limits **capture** only — `Screen Info` encoder FPS stays ~60
(repeated frames, cheap on the media engine). Measured: balanced + 45 fps + backlight off = 64 °C.

**Keep virtual-screen sides multiples of 16 (ideally 64).** 1080x1920 portrait was encoded as
`H264 VAAPI 1088x1920`: padding on the *width* misaligns every row and the screen showed up
garbled in VR. 2560x1080 is fine (padding lands on the height). Use 1152x2048, 1440x2560, etc.

**Passthrough portals (and screen positions) can't be saved from the PC.** Checked 2026-11-01,
Immersed Quest app 2.42.0: nothing about them is in `~/.ImmersedConf`; the headset app has
`com.oculus.permission.USE_SCENE`, is not debuggable (`run-as` refused) and has no `ALLOW_BACKUP`
flag, so its private data can't be read or backed up over adb. Its readable
`/sdcard/Android/data/Immersed.quest/files/debug.log` logs screen snapping/anchoring but nothing
about portals. So they live on the headset; **how** they are stored is unknown. `USE_SCENE` hints
at room anchoring, but that is an inference — they might equally be stored relative to
Immersed's own origin. Don't tell the user they survive a boundary reset or follow the room; ask
them to check after reconnecting (portal present? in the right place?) and record the result.
Docs checked 2026-11-01: Immersed's help centre (immersed.com/docs → immersed.helpscoutdocs.com;
Getting Started, Connecting Screens, FAQ, How-To) has **no article** on workspaces, saving
layouts, portals or boundaries. Only sources: the Apple App Store listing ("remembers your screen
layout and resolution locally on your headset"; Vision Pro build) and 2022 news of the portals
launch (shapes placed over desk/doorway; nothing on persistence). For a definitive answer use the
in-app Help chat or Immersed's Discord.

**Crisper text:** the limit is the headset (~25 px/degree on Quest 3), not the stream — a 1440-px-wide
virtual screen already packs more pixels per degree than the headset shows, so more resolution or
bitrate won't help. Bigger glyphs do: raise app font sizes (Alacritty `[font] size = 15`, Chrome
zoom 125–150%), bring screens closer in VR, or scale the virtual monitors in Settings → Displays
(by hand, not scripted, while Immersed streams). Keep `font-antialiasing` on `grayscale` (subpixel
colour fringes smear after 4:2:0 video compression); `font-hinting 'full'` sharpens stems slightly.

**Free-account screen cap (observed, not documented):** with 3 virtual slots enabled, a free
account got only 3 screens in total (physical + 2 virtual); the third enabled slot was silently
skipped (`Screen count is 3`, no error logged). Fit the layout into 2 virtual slots, e.g. slot 0
portrait for a terminal, slot 1 wide for the browser, small apps on the physical screen.

**Immersed vs WiVRn on a weak iGPU (measured, Intel UHD i5-1335U):** WiVRn+WayVR kept the render
engine (RCS) at 83–88% at ~1.2 GHz and panels wobbled; Immersed with 3 screens used RCS 31–42% at
~600 MHz, VCS 13–17%, 57–60 fps encode, and the user reported "very still, very sharp". Immersed
renders the room and panels on the headset, so a slow PC only slows screen *content*, never head
tracking. Prefer Immersed for text work on an iGPU.

Lag is **capture-bound**, not link-bound or encode-bound. Measured on a 780M:

| Config | Total pixels | Capture fps (phys / portrait / 720p) |
|---|---|---|
| 1920x1080 + 3440x1440 + 1280x720 | ~9.2 MP | 47.4 / 40.0 / 51.4 |
| 1920x1080 + 1440x2560 + 1280x720 | ~6.7 MP | 55.9 / 53.1 / 58.9 |

Encode stayed ~56–60 fps in both — so when capture fps drops on **all** screens, it is total-pixel
pressure on the iGPU, not one bad display. Attack order: drop the third screen first (biggest win),
then lower the largest resolution. Check `vcn_busy_percent` and system
swap/load average — a full swap file plus high load causes **input** lag easily mistaken for
display lag.

Rough suitability on this class of GPU: 2560x1080 comfortable, 3440x1440 workable, 5120x1440 a
stretch, 4K (~8.3 MP) at the limit. Immersed drops fps with more screens (`FPS:60`,
`FPSFor2:60`, `FPSFor4:30`). Bitrate caps are `LocalMaxBitrate:16000` / `RemoteMaxBitrate:8000`;
raising `LocalMaxBitrate` is the free quality win.

## 9. Where the work actually goes: CPU vs GPU

Diagnosed 2026-11-02 on Ubuntu 24.04 / GNOME 46.0 / libmutter 46.2 / Radeon 780M by measuring
per-thread CPU and kernel wait channels. Useful because "why is Immersed eating CPU?" and "can we
offload to the GPU?" have precise answers.

**Immersed renders nothing on the PC.** The binary contains no `vkCreateInstance` or
`glxCreateContext`; it references `MutterScreenCastSessionProxy`. It is a *consumer* of Mutter's
compositor output. The headset renders the room and panels. Consequences:

- **`gpu_busy_percent` (3D) is unrelated to VR.** 9–30% during a three-screen session was the
  browser and gnome-shell, not Immersed. Do not read 3D load as VR cost.
- **The H.264 encoder IS on the GPU.** `vcn_busy_percent` is Immersed's real GPU work
  (`Encoder Factory: NVENC: Unsupported / VAAPI: Supported`, `libva` + `libva-drm` +
  `libdrm_amdgpu` loaded).

**The CPU cost is capture plus pixel conversion — not encoding.** Thread evidence:

```
cores  state  wchan                                thread
0.282  R      (running)                            pipewire-main-l   <- the only working thread
0.144  S      drm_syncobj_array_wait_timeout       Immersed          <- blocked on a GPU fence
0.164  S      hrtimer_nanosleep                    Immersed          <- 60 fps pacing
0.142  S      hrtimer_nanosleep                    Immersed
0.046  S      futex_do_wait                        (several)
```

`drm_syncobj_array_wait_timeout` proves the GPU is encoding while a CPU thread merely waits. So a
raw "N cores" figure **overstates real work** — roughly a third is per-frame bookkeeping and
waiting on GPU fences. Measured 8.32 MP over three screens reported 1.79 cores, of which
**~1.2–1.3 was genuinely busy**, dominated by the single PipeWire thread. Quote it that way.

**Why it cannot be reduced:** there is no zero-copy path. Mutter delivers shared-memory frames;
Immersed must read each one, convert to a format VAAPI accepts (NV12 — `libswscale` is loaded and
resident), and upload it. That is unavoidable per frame per screen: three screens at 60 fps is
~180 frame handlings/sec. Cost scales roughly linearly with pixels (measured 4.61 MP → 0.85 cores;
8.32 MP → 1.79 cores).

**Nothing useful can be offloaded.** The dmabuf-vs-SHM choice is Mutter's ScreenCast negotiation,
not the client's; AMD's VCN has a VPP block that could convert on-GPU but Immersed shows no vpp
symbols; and the 3D engine's free capacity is irrelevant because a GL/Vulkan capture backend would
be a different application. Fewer pixels remains the only lever.

**`vcn_busy_percent` reaching 100 is NOT saturation.** It is bursty and independent of pixel count:
ten one-second samples at only 4.61 MP read `42, 100, 49, 44, 44, 43, 100, 99, 49, 100` while
capture held 50–57 fps and encode held 60. Judge load from the `Screen Info` capture/encode FPS,
never from a single VCN reading.

**BUT under real motion the encoder does become the limit — and then resolution is the right lever.**
Measured 2026-11-03 on a 780M, three screens totalling 8.32 MP, playing video on the ultra-wide:

| | idle desktop | video playing |
|---|---|---|
| VCN | ~40%, steady | **41–100%, saturating half the time** |
| Total bitrate | 1.6 Mbps | **5.3 Mbps** |
| Immersed CPU | 1.77 cores | 2.23 cores (+26%) |
| Encode fps | 60.2 | 59.6 |

Capture on the big screens fell ~1.5 fps and latency held at 8–9 ms, so the pipeline absorbed it — but
VCN hit its ceiling repeatedly. **Reducing the ultra-wide from 3440x1080 to 2560x1080 recovered
50.3 → 54.7 fps capture (+4.4, ~9%) on that screen, and the gain held even with a fourth 1920x1200
screen added.**

**Resolution reduction relieves the ENCODER, not the CPU — measured, do not get this backwards.**
Cutting that same 18.8% of pixel throughput (450 → 354 MP/s) changed CPU by **+0.6%: 1.77 → 1.80
cores. Zero saving.** Immersed's CPU cost is dominated by *per-frame bookkeeping across ~143 threads*,
not per-pixel work: `pipewire-main-l` did not move (0.35 → 0.36) despite 19% fewer pixels, and three
streams × ~50 fps × a ~48-thread pipeline each makes the fixed cost dominate.

So:
- **stutter on animated content → cut the biggest screen's pixels; this provably helps VCN**
- **high CPU → cutting pixels does nothing. Remove competing work instead** (browser, VMs, polling
  plugins) — that is the only measured CPU lever.

MP/s = pixels × that screen's capture fps is still the right *throughput* metric, but MP/s-per-core is
a weak, non-linear heuristic (318 MP/s/core at 4.61 MP vs 233 at 8.32 MP), so do not use it to predict
CPU savings.

## 10. Reading `Screen Info` without crying wolf

Two traps that produce false alarms. Both were hit, and both caused wrong diagnoses.

**`Encoder ... FPS:1.01` with low bitrate is an IDLE desktop, not a stall.** H.264 emits frames only
when pixels change, so a static screen legitimately reports ~1 fps at single-digit kbps. A healthy
example, verified while the session was known good:

```
Screen 0: Capture "Wayland" (0,0) 1440x2560 @ 53.50 FPS | Encoder FPS:1.01 Bitrate: 2kbps
Screen 1: Capture         (2317,11) 1280x720 @ 58.92 FPS | Encoder FPS:1.01 Bitrate: 1kbps
```

The discriminator is **`Capture - ` status plus `TotalFrame` movement**:
- healthy idle — `Capture - "Wayland" ... @ 50–59 FPS` and `TotalFrame` still advances across blocks
- genuine stall — `Capture - Not Running`, and `TotalFrame` identical across two blocks with
  different timestamps

Never read the encoder line alone. `0.0.0.0:21000` staying `LISTEN`, and a plausible-looking encoder
FPS carried over from before a teardown, are likewise not evidence of a live session.

**Blocks repeat.** Treat the cadence as ~5 minutes (observed `23:01:44`, `23:06:44`, `23:11:44`) and
wait for two blocks before calling anything stable. Always confirm a block's timestamp is newer
than the change you are reasoning about.

**"Feels laggy" with healthy FPS is host contention, not VR.** Measured: capture 49.3 / 57.0 /
51.0 fps, encode ~60, latency 3.7–8.1 ms — yet the user reported lag. The real change was on the
host: load average 7.35 (vs ~4.0), swap 4.3 → 5.9 GiB, and GPU `power1_average` 38 → 51 W with 3D
busy 9–11% → 23–30%. Swap thrash and competing CPU work produce input latency that feels exactly
like display lag. Check `power1_average`, swap growth and top CPU consumers **before** re-tuning
`VDData`. Raising GPU power with an unchanged VR config means another workload is on the iGPU.

**A stale `XAUTHORITY` stops Immersed from launching at all.** The agent needs working X11 auth even
though its display path is Wayland. Launching from a shell whose `XAUTHORITY` predates the current
XWayland fails instantly with `Authorization required, but no authorization protocol specified`.
Read the live path from the running server and use it:

```bash
pgrep -af Xwayland            # note the -auth path in the command line
XAUTHORITY=/run/user/1000/.mutter-Xwaylandauth.XXXXXX \
  setsid nohup ~/.local/opt/immersed/Immersed-x86_64.AppImage >/tmp/immersed-launch.log 2>&1 </dev/null &
```

**Filter by uid — `pgrep -af Xwayland` can match the GDM greeter's server.** After a session crash the
greeter keeps an Xwayland of its own under `/run/user/120/` (or another gdm uid). Grabbing "the first
`-auth` path" then launches Immersed against the login screen's server and it fails. Restrict to your
own runtime dir:

```bash
pgrep -af Xwayland | grep -oE '\-auth /run/user/'"$(id -u)"'/[^ ]+' | awk '{print $2}' | head -1
```

If that prints nothing, the live path is also discoverable directly:
`ls -t /run/user/$(id -u)/.mutter-Xwaylandauth.*`

This is not a permissions or config fault — do not debug the app over it.

## 11. Restarting is not free: it can take the whole session down

Established 2026-11-03. Stopping Immersed and rewriting `VDData` while virtual displays are live can
end in a **full GNOME session crash**, not a VR reconnect.

Observed: `pkill -x Immersed` (clean — process gone, ports 21000/21003 released), `VDData` slot
patched and verified, relaunch on the wrong `XAUTHORITY` → ~35 s later
`gnome-shell[pid]: GNOME Shell crashed with signal 6` and
`org.gnome.Shell@wayland.service: Failed with result 'core-dump'`. Session went to `closing`; only the
GDM greeter (a separate gdm-uid session) survived, and every app the user had open was lost.

- **Signal 6 is `abort()`**, i.e. typically an assertion failure — consistent with the documented
  `meta_monitor_mode_foreach_crtc` ← `sync_cursor_state` crash path on monitor-set changes while a
  screencast/virtual-monitor set is live.
- **The crash context is often unrecoverable afterwards.** After the session dies, `journalctl --user
  -b` no longer holds that session's records, `journalctl -b` for the window may return nothing,
  `coredumpctl list` may be empty, and there may be no kernel segfault line. If you need the cause,
  capture `journalctl --user -b -n 200` **before** logging back in.
- **Tell the user the real cost before stopping the agent.** "You'll need to press Connect again"
  understates it. Say plainly that a restart with virtual displays live can log them out and close
  everything, and that only a config file survives — their open work does not. If they are mid-task
  or have no display attached, that is a strong reason to defer.
- **The config change itself survives.** The patched `VDData` was intact after the crash (1536-byte
  file, correct slots), and applied correctly on the next launch.

### Recovering a session that died with no display attached

A crashed session is not a lockout — with user linger enabled, SSH, tailscale and any tailnet-bound
services keep running — but it is also not a desktop. With every DRM connector `disconnected`, GDM has
nothing to draw on.

Two ways back, in order of certainty:

1. **Plug any monitor in.** One `connected` connector gives GDM something to draw on, normal login
   resumes, and a fresh session appears in `loginctl list-sessions`. This worked in practice and took
   under a minute.
2. **`gnome-remote-desktop-headless`** — installed but **disabled by default**; it exists to create a
   virtual monitor for exactly this case, and RDP is already enabled in
   `gsettings org.gnome.desktop.remote-desktop.rdp enable`. `systemctl --user enable --now
   gnome-remote-desktop-headless`, then RDP to port 3389. **Not verified here** — GRD headless normally
   expects to be started by `gnome-session`, so it may refuse standalone. Do not promise it works.

**Ordering matters for VR:** Immersed's virtual monitors exist only inside a running GNOME session, so
recovery is (1) get a session, then (2) launch Immersed. Immersed cannot bootstrap a session.

## 12. What actually persists — and what you cannot save from the PC

Asked repeatedly, so state it plainly rather than letting someone chase a nonexistent feature.

**No physical output is required.** Unplugging the monitor mid-session works: Immersed's virtual
monitors become the session's outputs once they exist, so the session survives losing the physical
display (verified: 3 → 2 screens, offsets stayed correct, no crash). Only *bootstrapping* a session
with zero outputs is unsupported — see §11. Turning the physical panel off via DDC, DPMS or Mutter is
therefore unnecessary on a desktop; simply not plugging it in is the answer. The laptop "backlight
off" trick in §8 does not apply to an external monitor (`/sys/class/backlight` is empty).

**`VDData` is the only persisted layout, and it holds no positions.** Four fixed slots of `Width`,
`Height`, `IsEnabled`, `IsRotated`. Screen *positions* are never written by Immersed — the binary has
only receive-side symbols (`didReceiveDisplaySetOriginList`, `appliyDisplayOriginList`). They arrive
from the headset and are re-derived each session. So no profile, of any name, can restore where screens
sit.

**Mutter auto-saves the virtual layout to `~/.config/monitors.xml`, but it will not restore it the same
way.** Mutter picks an entry by *which connectors are present*, and `Meta-*` connectors only exist
while streaming — so after a replug it selects a different entry and re-packs the screens. Re-run
`vr-layout apply` against a current `desired.json` instead of expecting persistence.

**Snap-grid / StageLayout lives only on the headset.** Immersed on the PC has zero snap-related strings;
`~/.ImmersedConf` has no key for it. There is **no adb write path** — `run-as` is refused
(`package not debuggable`), there is no root, and the state sits in private Unity `shared_prefs`. The
only workable channel is *readback*: `debug.log` is world-readable, so

```bash
adb shell cat /sdcard/Android/data/Immersed.quest/files/debug.log \
  | grep -E 'AFTER snapGridIndices|Committing snapGridIndices' | tail -5
```

gives you a snapshot after each change. It is a backup, not a restore.

**Diagnosing "snapping doesn't work" — from the headset, never the PC.** Snaps can register, commit and
still not stick. Three signatures seen together:

- a monitor re-anchoring to the same snap point every cycle (`Anchoring monitor 0 to snap point 0`),
  which force-sets follow mode and pushes every other screen off (`Non-anchor snapped, forcing follow
  mode off`)
- two monitors swapping points in a loop, each clearing the other's claim (`Clearing snapGridIndex N
  for monitor M` in both directions)
- **`BFEORE` and `AFTER` arrays identical in every pair** — the decisive one. Across 37 cycles it read
  `0, 2, 1, 3, 4` both before and after, i.e. the commit writes back what it read, so each drag
  re-derives to the same assignment

Note the array is 5 wide but every `snap to N` observed was 1–3; with one point reserved by the anchor
that leaves too few for three screens, which is a plausible tie. Untested remedy: unsnap everything,
snap the smallest screen **last**, and keep the anchor monitor off the grid until the others settle.

**Audio is on by default and costs nothing.** `EnableAudio` is a single config key (toggle it in
Settings — `settings_enable_audio_clicked`; there is **no `--enable-audio` CLI flag**: `enable_audio_cli`
is a UI element id). It records the current default sink's monitor at `s16le, 16000 Hz, mono`. Measured
`audioThread` at **0.000 cores** — treated as a suspect for stutter only as wasted effort.

**Never edit `~/.ImmersedConf` while the agent runs** — it rewrites the file on exit. And back it up
before touching it: `Client` holds an encrypted auth token, so every `.bak` copy is a credential.

**`VDData` slots 2 and 3 ship byte-identical, so a content-based replace is ambiguous.** A targeted
byte replace matches twice, not once. Find all matches, assert the count, and replace by **offset**
(the first is slot 2). Once slot 2 is enabled it becomes unique and a plain single-occurrence replace is
safe again. Re-run the escaping check after any patch: the file stores a doubled layer, and naive
`json.loads` fails — a tolerant regex over `Height…IsEnabled…IsRotated…Width` works.

**A session teardown does not kill the agent.** If the headset drops, Immersed logs
`TCP Disconnected by Read Error End of file` → `Session Deinit Display` → `Reloaded screen count: 1`, and
every screen reads `Capture - Not Running`. The agent keeps running (same PID, config untouched) and
`0.0.0.0:21000` stays `LISTEN`. **So `Screen count is 1` plus `Capture - Not Running` means the link
died, not the app** — no restart needed until the user reconnects.

**`TCP: true. USB: true` at session start is a capability line, not the transport.** It printed `true`
for a session that demonstrably ran wirelessly. Check `lsusb | grep 2833` and `adb devices` before
claiming which path is in use.

**A marginal USB link shows up as `error -71`, not as slowness.** `device not accepting address`,
`can't set config #1, error -71` and repeated re-enumeration mean signal integrity — a bad cable or hub
port. On this class of host the Quest often negotiates **480 Mb/s USB 2.0** behind a monitor's built-in
hub even when a USB 3 port is free; that caps the link but at these bitrates (tens of kbps to a few
Mbps) it is not the bottleneck. Do not "fix" stutter by changing cables without measuring first.

## 13. Tracing stutter: where the frames actually go

Established 2026-11-03 on Ubuntu 24.04 / GNOME 46.0 / libmutter 46.2 / Ryzen 7 8700G + 780M,
three virtual screens, Quest 3 over USB. Use this when the report is **"video isn't smooth"** rather
than "the screen is frozen" — a different failure with different evidence.

### The path, and what to measure at each hop

| # | Hop | How to measure | Healthy |
|---|---|---|---|
| 1 | Mutter ScreenCast → PipeWire | `Capture - "Wayland" … @ N FPS` | ~60 |
| 2 | PipeWire → Immersed (BGRA, SHM) | `pw-top`; watch the `ERR` column | no growth |
| 3 | BGRA→NV12 → VAAPI H.264 (VCN) | encoder `FPS:` on the same block | ~60 |
| 4 | adb tunnel `:21013` | `ss -tni`, `bytes_sent` delta | ≪ link, `send-q=0` |
| 5 | Quest decode | `adb shell … debug.log` | no `dequeueOutputBuffer timeout` |

**The stutter is made at hop 1 on this class of hardware, and you can prove it without a profiler.**
Two numbers on one `Screen Info` block settle it:

- `Capture - … @ N FPS` is *unique frames captured per second*.
- encoder `FPS:` stays pinned near 60 regardless.

When capture < encode, the encoder is re-sending the previous frame. That gap **is** the judder:
motion advances in uneven steps. Measured on three screens in one session:

```
1440x2560 (3.69 MP)  capture 51.0   -> ~9 duplicate frames/s (15%)
2560x1080 (2.76 MP)  capture 54.0   -> ~6/s (10%)
1280x720  (0.92 MP)  capture 58.6   -> ~1.4/s (2%)
```

Capture FPS falls monotonically with pixels, with encoder, decoder and link held constant — so the
limiter is the capture stage, not encoding, not transport, and not the headset.

### The two tests that separate capture from everything downstream

1. **Pixel-count sweep.** Same session, three screen sizes, encoder at 60 on all three. If capture
   FPS tracks pixels inversely, it is the capture stage. (A per-pixel cost model is *not* valid —
   see the CPU note below.)
2. **Full-screen video playback.** Play a real video fullscreen on one virtual screen and re-read
   capture FPS. Measured: the ultrawide stayed at **52.3 fps vs 52.4 baseline while its bitrate
   rose 150 → 1645 kbps**. Content demand is irrelevant — capture is out of time, not starved of
   change. If playback instead *raises* capture toward 60, you are damage-limited, not
   throughput-limited, and the fix is different.

Fitting the three points gives roughly **15.5 ms of fixed cost per frame against a 16.67 ms
budget**. Anything larger than ~1 MP misses the deadline and slips to the next slot; 720p squeaks
through at 58.6. That is the whole mechanism for *rate*.

### SECTION: `capture fps` does NOT predict which screen FEELS smooth

**This is the most important caveat in this section, and it was learned the hard way** (2026-11-03,
after the pixel model above had already been written up and presented).

The user reported the **tall 1440x2560 portrait screen as the smooth one** and the
**1280x720 + 2560x1080 screens as uneven** — the exact inverse of what the capture-rate model
predicts. Over 94 `Screen Info` blocks in one session:

| Screen | mean capture | spread (max-min) |
|---|---|---|
| 1440x2560 portrait | **53.2** (lowest) | **10.5** (widest) |
| 2560x1080 ultrawide | 55.4 | 7.0 |
| 1280x720 | **58.9** (highest) | 2.9 (tightest) |

So the metric that "proves" the capture stage limits throughput does **not** rank screens by
perceived smoothness. Treat them as two different questions:

- **"Is the pipeline losing frames?"** → capture vs encode on one block. Valid.
- **"Which screen looks jerky to the user?"** → capture fps is **not** the answer. Do not use it to
  rank screens, and do not tell a user their smooth screen should look bad.

Ruled out while chasing this:

- **Capture-row alignment — NOW THE LEADING HYPOTHESIS (reopened 2026-11-03 after a user A/B test).**
  The only feature that splits the screens exactly the way the user reports:

  | Screen | capture offset | `y % 4` | user verdict |
  |---|---|---|---|
  | 1440x2560 portrait | `(0, 0)` | **0** | **smooth** |
  | 1280x720 | `(1440, 535)` | **3** | uneven |
  | 2560x1080 ultrawide | `(1440, 1255)` | **3** | uneven |

  **My first refutation of this was invalid — do not repeat it.** I compared the odd-offset layout's
  capture fps against the earlier all-`y=0` "tidy row" period, and because 54.8 vs 55.4 looked the same
  I concluded "no effect". That was the wrong test: in the tidy-row period **every** screen was at
  `y=0`, so the experiment had no comparison group. Worse, the metric itself was already known not to
  predict smoothness, so using it to refute the hypothesis was circular. **A metric that cannot detect
  the effect cannot clear the hypothesis.**
  The user's own discriminator is much better evidence: "portrait is smoother on video, **even when I
  show only half the screen in ultrawide and 720p**" — halving the ultrawide removes the size and
  aspect-ratio confounds and the judder persists, which leaves placement.
  **Mechanism (plausible, NOT yet proven):** an unaligned source offset forces per-row realignment in
  the BGRA→NV12 conversion and/or a sub-rect upload to VAAPI, instead of a straight copy. That costs
  time per frame and can land frames unevenly, precisely on the screens whose `y` is not a multiple of 4.
  **Test to run:** align all three screens to `y` multiples of 4 (or all to `y=0`) and re-run the
  three-video A/B. If the judder follows the offset, this is it. If it stays on the same physical
  screens, it is per-stream on the headset.
- **Follow mode / anchoring.** All screens log `follow mode ... False`; nothing is head-locked.
- **Content demand.** The smooth portrait carried by far the *most* motion (2541 kbps vs 79 and
  282) — again the inverse of a "bigger draw = worse" reading.

Leading hypotheses, **unproven** — do not state either as fact:

1. **Perceptual / rendering, not the stream.** ~55 fps on a large canvas with smooth continuous
   motion (a scrolling document) hides judder; a mostly static desktop where only a cursor moves
   makes every late frame obvious. A smooth pan can also *mask* 3:2 pulldown.
2. **A per-stream decoder asymmetry on the headset** — one stream in software, two in hardware.
   This would explain a clean 1-vs-2 split, but there is **no positive evidence**: the Quest
   `debug.log` only records *faults*, so it is silent when healthy and exposes no per-screen frame
   stats. The app is not debuggable, so this cannot be read out from the PC.

**The experiment that settles it is visual, not log-based.** Put the *same* content (same window,
same scroll speed, ideally same apparent size) on the smooth screen and on a jerky one and compare
side by side. If the judder follows the screen, it is per-stream (headset side). If both look alike,
perception was the confound. Ask the user to run it — do not substitute a counter for their eyes.

**Run the identical-content test across ALL screens at once, and mind the aspect-ratio trap**
(2026-11-03). Launching the same file fullscreen on every virtual screen simultaneously removes
content as a variable and simultaneously confirms placement, because the encoder **bitrate** on each
screen jumps only if a window really landed there:

```bash
for n in 0 1 2; do
  setsid nohup mpv --fs --fs-screen=$n --no-border --loop --mute "$VIDEO" >/tmp/mpv-$n.log 2>&1 </dev/null &
done
```

Measured result (baseline → during, and capture before → during):

| Screen | Bitrate | Capture fps |
|---|---|---|
| 1440x2560 portrait | 439k → **537k** | 49.5 → **48.7** |
| 1280x720 | 42k → **806k** | 56.7 → **57.7** |
| 2560x1080 ultrawide | 282k → **1728k** | 52.1 → **51.8** |

**Capture fps moved <1 fps on every screen with real motion on all three** — the cap is structural,
so this does settle that capture is not content-limited. It does **not** settle smoothness.

Two traps that make this test misleading if unhandled:

- **Aspect ratio defeats "identical content".** The same *landscape* video on a *portrait* screen
  letterboxes into a horizontal strip, so it changes far less area — hence portrait 537k against the
  ultrawide's 1728k from the same file. A portrait screen tested this way has the least changing
  pixels of the three, which is the least fair setup for judging it. Either match apparent size, or
  test with content whose shape matches the screen.
- **Placement is the silent failure mode.** `--fs-screen=N` uses Mutter's monitor order, which need
  not match Immersed's `ScreenID`. Verify with bitrate, not by assuming. `Capability access manager`
  / GNOME's own screencast permission can also silently prevent a window from appearing.

**Host state during three simultaneous videos**, for scale: `vcn_busy_percent` **47%**, 3D GPU
**37%** — the media engine was **not** saturated by three 60 fps streams, so encoder saturation is not
what limits this configuration. Two `plannotator` pollers were eating **103% CPU each** throughout.

### Separate stutter source: refresh-rate mismatch

The Quest panel reports **90.00 Hz** while the stream is 60 fps
(`adb shell dumpsys SurfaceFlinger | grep 'VSYNC period'` → `11111111 ns`). 60 into 90 is 3:2
pulldown: every frame is held 1 or 2 refreshes, giving inherent judder in content motion. **No
capture-side fix makes 60 fps on 90 Hz clean** — do not promise that it will, and do not chase it
as a capture bug. Check the panel rate before concluding the stream is at fault.

### What does NOT explain it

- **The USB link.** Measured **683 kbit/s** against a 480 Mbit/s USB 2.0 link, `send-q=0`,
  `retrans 0/5`. The link is ~0.1% used. Do not tune bitrate for stutter.
- **The encoder clock.** `pp_dpm_vclk` reaches **2400 MHz** at load and `socclk` 1200 MHz. A single
  `head -1` read of `pp_dpm_vclk` returns level 0 and looks like 800 MHz — **that is a parsing
  error, not a stuck clock**. Always `grep '\*'` for the active level.
- **Pixel count as a CPU lever.** It is not one (see §9). Shrinking screens helps the *encoder* and
  the *capture deadline*; it saves ~0.0 cores.

### Quest-side decoder: `NO_MEMORY` → silent software fallback

A separate, intermittent fault on the headset, worth ruling out whenever the *whole* stream is
choppy rather than one screen:

```
E AndroidVideoDecoder: decode() - no HW buffers available; decoder falling behind
E AndroidVideoDecoder: initDecode failed  android.media.MediaCodec$CodecException
E AndroidVideoDecoder: initDecode failed MCandroid.media.MediaCodec.error_neg_19 -19
W AndroidVideoDecoder: reinit status:FALLBACK_SOFTWARE
```

`-19` is `NO_MEMORY`. Once it happens the stream decodes **on the headset's CPU**, which looks like
stutter at every resolution. Over the log's history: 549 × `error_neg_19`, 465 × `FALLBACK_SOFTWARE`.

**The healthy-vs-broken discriminator is the timeout counter, not the decode counter.** In a broken
session `dequeueOutputBuffer timeout` climbed to **5231** with the decode count frozen, and an
orphaned decoder thread kept polling after its surface was gone
(`We couldn't find …#0 surface to remove!`). In a healthy session the count is **0** — a decoder
that keeps up does not log. Note the decode count itself can sit at a fixed value on an idle stream,
so a frozen counter alone does *not* prove starvation; look for the timeout spam.

Contributing condition: the headset runs tight — **278 MB free of 7.9 GB** with ~1 GB swapped.
Four streams contending for HW decoders is what tips it over. Remedy is a Quest restart / fewer
simultaneous streams, not a PC-side change.

### Two host-side things that look like VR stutter

- **Mutter drops capture frames outright** — `gnome-shell: Not enough buffers (16) to accommodate
  damaged regions (N)`, thousands of occurrences per boot. This is Mutter failing to get a capture
  buffer. It is a **skipped frame**, distinct from the throughput ceiling above, and it persists
  until gnome-shell is restarted (a full logout/login on Wayland — `Alt+F2 r` does not reload).
- **A browser running with hardware acceleration disabled** burns CPU in the same window as the
  capture. Check `hardware_acceleration_mode.enabled` in `Local State` and whether the GPU process
  carries `--use-gl=disabled`. Software video decode competing with capture is self-inflicted and
  cheap to fix.
  **But measure it before recommending it — it is a small effect, not a stutter fix.** Verified on a
  780M by running three throwaway profiles (`--user-data-dir=/tmp/...`, never the user's live
  profile) and playing the same local file for a 12 s steady-state window: software decode
  **13.9%**, stock **14.7%**, `--enable-features=VaapiVideoDecoder` **12.4%** CPU — i.e. **~2% of one
  core**. Worth turning on; will not change judder. Check the real capability rather than assuming:
  `SystemInfo.getInfo` over CDP on a fresh profile reported
  `ANGLE (AMD, AMD Radeon 780M Graphics (radeonsi phoenix), OpenGL ES 3.2 Mesa ...)` with
  `video_decoding` enabled at up to **4096x4096**. `hardware_acceleration_mode.enabled=false` in a
  profile is a **user-visible Chrome setting** (Settings → System → "Use graphics acceleration when
  available"), not a broken driver — do not go driver-hunting.
  **Flag-reading trap:** `--disable-gpu` and `--disable-gpu-compositing` do not share a prefix
  boundary for a naive `grep -c -- '--disable-gpu'`. Counting that way reported "30x `--disable-gpu`"
  when the truth was **2** real ones plus **27** `--disable-gpu-compositing`. Both are Chrome's
  *downstream* consequence of acceleration being off, not the cause. Split on whitespace and use
  `grep -x` before quoting a flag count.

### Profiling honestly

`perf`/`bpftrace` need `perf_event_paranoid ≤ 1` or root; on a locked-down host (`= 4`) both refuse
to sample userspace. **Say so rather than implying you profiled.** Everything above comes from
counters — `/proc`, `pw-top`, the `Screen Info` block, `adb logcat`, and Mutter's D-Bus — and those
are sufficient to localise stutter to a hop. If you do get privileges:

```bash
sudo perf record -F 999 -g -p $(pgrep -x Immersed) -- sleep 20
sudo perf report --stdio --sort symbol | head -40
```

### Ordered remedy list for stutter

1. Read one `Screen Info` block; if `Capture` < `Encode` on every screen, it is the capture ceiling.
2. Check the Quest decoder log for `dequeueOutputBuffer timeout` / `FALLBACK_SOFTWARE` — a headset
   restart may fix more than any PC tuning.
3. Check the panel refresh rate for a 60-into-90 pulldown mismatch (unfixable from the PC).
4. Reduce total pixels **only for encoder saturation or capture-deadline misses** — expect ~0.0
   cores saved.
5. Remove competing CPU/IO work (VMs, pollers, software-rendered browser). This is the only measured
   CPU lever on such a box.

## Honesty rules

- Do not state a maximum resolution. `MaximumScreenPixel` / `MaximumScreenWidth/Height` are
  runtime settings; their values are not readable from the binary.
- Do not claim the headset reconnects by itself — it does not.
- Do not claim a `ApplyMonitorsConfig` layout survives a reconnect — it does not.
- Do not use bitrate as proof of a freeze.
- Do not read `Encoder ... FPS:1.01` as a stall — that is an idle desktop. Use `Capture - ` status
  and `TotalFrame` movement (see §10).
- Do not read a single `vcn_busy_percent` reading as saturation; it is bursty (see §9).
- Do not read `gpu_busy_percent` (3D) as VR cost — Immersed renders nothing on the PC (see §9).
- Before asserting a cause, line up event timestamps: `journalctl --user --since` for exact
  seconds, and re-read a `Screen Info` block only if its timestamp is newer than the change.
  Several wrong diagnoses were made by skipping this.
- Do not name a third-party tool from memory. Verify the repository or package exists and is the
  right project before recommending it — a "virtual display" tool was once recommended whose repo
  returned 404 while an unrelated package held the same name.
- Do not describe stopping the agent as merely "you'll need to press Connect again". With virtual
  displays live it can log the user out and destroy their open work (see §11). State that risk
  explicitly before acting, and defer if they are mid-task or have no display attached.
- Do not present resolution reduction as a CPU fix. **Measured: cutting 18.8% of pixel throughput
  saved 0.0 cores** (1.77 → 1.80). Cost is per-frame bookkeeping, not per-pixel. Resolution *is* the
  right fix for encoder saturation during animated content (see §9).
- Do not claim screen positions, snap-grid state or passthrough portals can be saved or restored from
  the PC. None of them can (see §12).
- Do not read `Screen count is 1` as "the agent died" — a dropped headset deinits displays in place
  while the agent keeps running (see §12).
- Do not treat `TCP: true. USB: true`, a listening `21000`, or a stale encoder line as evidence of a
  live session.
- On "video isn't smooth", do not blame the link or the encoder before reading capture vs encode FPS
  on one block. Measured: capture 51–54 fps against encoder 60 pinned, on a link 0.1% utilised
  (see §13).
- Do not claim a 60 fps stream on a 90 Hz panel can be made smooth by changing PC-side settings —
  3:2 pulldown is inherent (see §13).
- Do not read a frozen Quest `decode count:` as decoder starvation by itself; the signal is
  `dequeueOutputBuffer timeout` spam, and `error_neg_19` / `FALLBACK_SOFTWARE` (see §13).
- Do not imply you profiled with `perf`/`bpftrace` unless you actually ran them. With
  `perf_event_paranoid > 1` and no root they refuse to sample userspace — say so and use the
  counters in §13 instead.
- Do not use `Capture ... @ N FPS` to rank screens by *perceived* smoothness. Measured: the screen
  with the **lowest** mean capture (53.2) and **widest** jitter was the one the user reported as
  **smooth**, while the highest-capture screen felt uneven (see §13). Throughput and perception are
  separate questions, and no PC-side counter substitutes for the user's eyes.
- Do not claim a capture-offset alignment bug is ruled out. It is the **leading open hypothesis** for
  the 1-vs-2 smoothness split and the offsets line up exactly (`y%4`: smooth screen 0, both uneven
  screens 3). An earlier "refutation" compared against a layout where all screens were aligned, so it
  had no control group — see §13.
- Do not clear a hypothesis using a metric already shown not to track the effect. Capture fps cannot
  rank perceived smoothness, so it cannot refute an alignment theory either.
- Do not present re-enabling a browser's hardware acceleration as a stutter fix — measured **~2% of
  one core** (13.9% vs 12.4%) playing the same video (see §13).
- Do not assume `vr-layout` honours `desired.json` — pre-2026-11-02 copies ignore it and apply the
  built-in layout that **moves the primary** (see §5). Run `vr-layout show` and read its `desired:`
  block before any `apply`.
- Weight the user's controlled A/B over any counter. "Smoother even when I only show half the screen"
  removes size and aspect confounds in a way no log field can.
