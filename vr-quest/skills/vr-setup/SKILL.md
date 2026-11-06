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
differ per host (`vr-layout show` lists them). `vr-layout` snapshots live in `~/.config/vr-layouts/`. `restore` only accepts timestamped
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
| `Session creation inhibited` + `Screen count is 0` | stuck screen lock, not a stream fault — see below |

### `Session creation inhibited` — a stuck screen lock, not Immersed

Every connect fails immediately and no Screen Info block is ever emitted:

```
Failed to create remote desktop session: GDBus.Error:org.freedesktop.DBus.Error.Failed: Session creation inhibited
Screen count is 0
```

This is **Mutter refusing all screen-cast sessions**, and restarting Immersed will never fix it.
Confirm it without Immersed in the loop:

```bash
gdbus call --session --dest org.gnome.Mutter.RemoteDesktop \
  --object-path /org/gnome/Mutter/RemoteDesktop \
  --method org.gnome.Mutter.RemoteDesktop.CreateSession    # same error = not an Immersed problem
```

Cause: gnome-shell inhibits remote access whenever the session mode is not `user`
(`js/ui/main.js`: `if (!sessionMode.allowScreencast) remoteAccessController.inhibit_remote_access()`).
Only `user` sets `allowScreencast: true`; `unlock-dialog` inherits `false`. So a lock that started
but never completed — leaving the shell in `unlock-dialog` — blocks every cast until it finishes.

Diagnose from the two sources disagreeing (measured 2026-11-05):

```bash
SID=$(loginctl show-user "$USER" -p Display --value)   # $XDG_SESSION_ID is often UNSET in agent shells
loginctl show-session "$SID" -p LockedHint             # yes
gdbus call --session --dest org.gnome.ScreenSaver --object-path /org/gnome/ScreenSaver \
  --method org.gnome.ScreenSaver.GetActive                # (false,)  <- claims unlocked
gdbus call --session --dest org.gnome.ScreenSaver --object-path /org/gnome/ScreenSaver \
  --method org.gnome.ScreenSaver.GetActiveTime            # non-zero, ~= time since the failed lock
```

A non-zero `GetActiveTime` while `GetActive` is `false` is the fingerprint: the shield's activation
time was set and never cleared. Corroborate in the journal at the matching second:

```bash
journalctl --user --since "<that time>" | grep -i "couldn't lock"
# gsd-media-keys: Couldn't lock screen: Timeout was reached
```

**Fix:** finish the lock transition so the mode pops. Either unlock normally (switch to the
physical console / plug in a monitor and unlock), or force it:

```bash
gdbus call --session --dest org.gnome.ScreenSaver --object-path /org/gnome/ScreenSaver \
  --method org.gnome.ScreenSaver.SetActive false    # -> shield.deactivate(false), pops unlock-dialog
```

The `SetActive false` route is read from source (`MetaScreenShield.deactivate` pops the mode) but
was **not verified end-to-end** — the session recovered by unlocking at the console first. After the
mode returns to `user`, the `CreateSession` probe above must stop erroring; only then restart
Immersed (§7) and press **Connect** in the headset.

### Bitrate is not a stall signal

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

Everything above is **USB only**. When the headset connects over WiFi instead, the transport is
WebRTC/UDP straight to the Quest's LAN IP — there is no adb reverse, `adb devices` is empty, and
the errors look completely different (measured 2026-11-06, 5 GHz ch153, 80 MHz, -63 dBm):

| Symptom in log | Meaning |
|---|---|
| `stun_port.cc ... UDP send of N bytes to host 192.168.x.y:PORT failed with error 11` | **EAGAIN** — socket send buffer full, frames dropped. Bursty, not constant |

Those `error 11` bursts are the WiFi equivalent of a stall and are **not** a dead stream — the
`Screen Info` block keeps advancing (measured: 38006 frames, 60 fps encode). Fix order:
turn WiFi power save off, then move closer to the AP.

On Ubuntu it is **on by default**, and NetworkManager sets it — not the driver. Read all three
before blaming anything else:

```bash
iwconfig <if> | grep -i "power management"                  # Power Management:on
nmcli -f 802-11-wireless.powersave connection show "<SSID>" # 0 (default) = inherit global
cat /sys/module/iwlwifi/parameters/power_save               # N  = driver is NOT doing it
grep -r powersave /etc/NetworkManager/conf.d/               # wifi.powersave = 3  <- the cause
```

Per-network (survives reboot, small blast radius, `powersave 0` undoes it):

```bash
nmcli connection modify "<SSID>" 802-11-wireless.powersave 2   # 2 = disable
nmcli connection up "<SSID>"
```

Globally, to undo the Ubuntu default:
`sudo sed -i 's/wifi.powersave = 3/wifi.powersave = 2/' /etc/NetworkManager/conf.d/default-wifi-powersave-on.conf`
then `sudo systemctl restart NetworkManager` (this drops the link for a few seconds).

**Editing that file alone does nothing — the restart is mandatory.** NetworkManager reads
`conf.d/*.conf` only at startup and keeps the old value in memory indefinitely. Measured
2026-11-06: file changed to `wifi.powersave = 2`, `systemctl restart` not run, and the interface
still reported `Power Management:on` an hour later while `nmcli` showed `0 (default)` — inheriting
the stale in-memory `3`. Check the daemon start time before concluding a setting failed:

```bash
ps -eo pid,lstart,cmd | grep -E 'NetworkManager( |$)' | grep -v grep   # older than your edit?
iwconfig <if> | grep -i "power management"                             # want: off
```

Note the driver param `/sys/module/iwlwifi/parameters/power_save` reads `N` in this situation — it
tracks the module parameter, **not** NM's per-interface setting, so it cannot confirm or refute
this. Trust only `iwconfig`'s `Power Management` line.

Also: a burst of `error 11` can stop on its own. Measured here, 0 new EAGAIN in the 30 min after
10:10 with power save still on — so a quiet log is **not** proof the power-save change worked.
Judge it by whether the `RTT:` series across `Screen Info` blocks comes down, sampling repeatedly
over at least 20 min — never by one early sample, and never by absence of errors.

Measured result of actually disabling it (2026-11-06, same session, NetworkManager restarted at
10:47:33; RTT sampled one pair per `Screen Info` block):

```
before  10:14 29   10:18 34   10:23 12   10:28 16   10:33 6   10:38 6   10:43 10   mean ~16, max 34
after   10:48 4    10:53 4    10:58 5    11:03 22   11:08 5   11:13 7             mean ~8,  max 22
```

Power save off **roughly halved the mean RTT and lowered the ceiling, but did not flatten it** — a
22 ms spike appeared 16 min after the change, with **no** `error 11`/`101` in the log at that moment.
So: real improvement, partial fix. Do not record it as "flat"; an early pair of 4 ms samples is not
a trend, and re-sampling later is what caught this.

**Residual jitter is below Immersed.** Concurrently, `ping <gateway>` reported `min/avg/max/mdev =
1.9/4.5/16.3/3.4 ms` — the laptop ↔ router hop is itself spiky while Immersed is idle-ish. So once
power save is off, chase the remaining variance at the radio/AP level (airtime contention, -59 dBm
signal, neighbours on the same channel), not in Immersed or its config.

**Expect `stun_port.cc ... failed with error 101` for a moment after the restart.** `101` is
`ENETUNREACH`, not `11`. Measured 10 bursts in the ~10 s window while the link re-DHCP'd, then it
stopped. Harmless and self-clearing — do not chase it as a new fault.

### What the VR stream actually costs on the link

Do **not** quote `Screen Info`'s `Bitrate:` as network usage — it is the encoder's instantaneous rate
for a near-static desktop and understates the wire cost about 4×. Measured on one session:

| Where | Value |
|---|---|
| `Screen Info` `Bitrate` (2 screens, idle desktop) | 587–636 kbps |
| **Actual `wlp4s0` TX with VR streaming** | **~2.2 Mbit/s** |
| Actual TX during a big download | 13.9 Mbit/s |
| Idle background RX (onedrive, sync daemons) | 92 kbit/s |

Always measure with
`cat /sys/class/net/<if>/statistics/{rx,tx}_bytes` across a known interval — no root needed.

**Immersed over WiFi does not meaningfully slow the internet.** Same host, VR streaming live:
WAN delivered **70.8–75.2 Mbit/s** across four samples while the radio received **437.8 Mbit/s** —
the link had ~6× headroom over the WAN, so the ISP/router is the cap, not WiFi. The VR stream is
~3% of WAN capacity. If you need to *prove* WiFi is not the constraint, compare NIC `rx_bytes` rate
against a speed test: when they diverge like this, WiFi is not limiting.

**Wired will not rescue this.** The costly hop is laptop → router → Quest, and the Quest is on WiFi
either way; a down/unplugged ethernet port changes nothing. Only the USB cable removes WiFi from
the path (see §6 transport facts).

**Do not read `iwconfig` "Bit Rate" as the link rate.** On `iwlwifi` it reports a cached legacy
value — measured `Bit Rate=54 Mb/s` on an 80 MHz 2x2 AX link at -63 dBm that was demonstrably
passing 188 pkt/s with 0% ping loss. The real rate needs `iw dev <if> station dump`, which is not
installed by default (`sudo apt install iw`). Interface-level `tx_bytes`/`rx_bytes` in
`/sys/class/net/<if>/statistics/` measure actual throughput and work without root.

**Latency is the WiFi cost, not bandwidth.** Same session, RTT tracked across successive
`Screen Info` blocks climbed `4 → 5 → 5 → 6 → 7 → 8 → 8 → 12 → 20 → 29 → 34 ms` (USB hosts stayed
sub-10 ms). Real wire cost was ~2.2 Mbit/s against a 16 Mbit/s cap — an idle desktop compresses to
almost nothing, so *bandwidth is never the constraint* on WiFi; latency and buffer overruns are.

**An internet speed test is not a link measurement, and this one was wrong twice.** First measured
10.3 Mbit/s, then 70.8–75.2 Mbit/s on the same link later the same hour with no config change in
between — most likely transient congestion or TCP state, unverified. Do not draw conclusions from a
single WAN sample, and never use it to infer the WiFi rate (see the `rx_bytes` comparison above).

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
- Do not claim a restart fixes `Session creation inhibited` — it is a shell session-mode state, and
  Immersed is not the culprit.
- Before asserting a cause, line up event timestamps: `journalctl --user --since` for exact
  seconds, and re-read a `Screen Info` block only if its timestamp is newer than the change.
  Several wrong diagnoses were made by skipping this.
