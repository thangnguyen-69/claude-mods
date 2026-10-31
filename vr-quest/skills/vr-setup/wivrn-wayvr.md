# WiVRn + WayVR — open-source VR desktop for a Quest (no subscription)

Established on Fedora 42, GNOME Shell / Mutter on Wayland, Lenovo ThinkPad T14 Gen 4
(i5-1335U, Intel UHD iGPU, 16 GB RAM), Meta Quest 3, WiVRn 26.9 (Flathub) and WayVR v26.8.0.
Where something is unverified it says so.

## What each piece does

- **WiVRn** = an OpenXR runtime (built on Monado) on the PC + a client app on the headset. VR
  apps render into it; it encodes **only what the eyes see** (one stereo video stream) and sends
  tracking back. Panel count does not change stream cost.
- **WayVR** = an OpenXR app that draws panels in VR. It can mirror monitors (GNOME screen-share
  portal → PipeWire) and runs its **own small Wayland compositor** to open apps *directly* in
  VR. GNOME stays the desktop compositor.

```
GNOME desktop ─(PipeWire capture, optional)─► WayVR ─(OpenXR)─► WiVRn server ─(video, USB/Wi‑Fi)─► Quest
                                                ▲                                                  │
                                                └──────────── hand / controller tracking ◄─────────┘
```

Versus Immersed: free and local, no account; USB and hands work; runs real VR apps too. Missing:
true extra virtual monitors on GNOME (work in **app panels** instead), and Immersed-grade hand UI
(no poke-to-touch). Cost is RAM (apps and panel buffers), not streaming.

## 1. Install

### WiVRn server — Flathub, not the distro package

The PC server and the headset app (Meta Store) **must be the same version exactly**, or the
headset shows "incompatible server version". Fedora's `wivrn` package lagged (26.2.3 vs 26.9).

```bash
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --user flathub io.github.wivrn.wivrn
```

(The `--user` remote matters on Fedora: the system flathub remote can be filtered.) Config lives
at `~/.var/app/io.github.wivrn.wivrn/config/wivrn/config.json`.

### WayVR — the standalone binary, not the AppImage

From the WayVR GitHub release take the **`wayvr`** binary (and **`wayvrctl`**, the control CLI).
The AppImage did not run: AppImageLauncher's binfmt hook cannot read the new AppImage runtime, and
`unsquashfs` could not extract it either.

```bash
mkdir -p ~/Applications/lib
install -m755 wayvr ~/Applications/wayvr-v<VERSION>          # versioned name; scripts pick the newest
install -Dm755 wayvrctl ~/.local/bin/wayvrctl
# Valve's libopenvr_api.so (not packaged on Fedora): from ValveSoftware/openvr bin/linux64
cp libopenvr_api.so ~/Applications/lib/
```

The `wayvr` wrapper script sets `LD_LIBRARY_PATH` and finds the newest binary.

### Helper scripts

Install all of them from this skill's `scripts/` (see SKILL.md's install block). Env overrides:
`WAYVR_BIN`, `WAYVR_LIB_DIR`, `ALACRITTY`, `VR_FONT_SIZE`.

| Script | Does |
|---|---|
| `wayvr` | wrapper: libopenvr path + newest binary |
| `vr-start` | cold start: server, fresh WayVR, USB (adb) or Wi‑Fi |
| `vr-reconnect` | reopen WiVRn on the headset over USB; keeps VR apps |
| `vr-ready [secs]` | wait until WayVR answers IPC (= running and headset worn) |
| `vr-workspace` | open each app in `~/.config/vr-workspace` once; they return to saved spots |
| `vr-term` | open a tall large-font terminal *inside* VR |
| `alacritty-vr` | Alacritty with a bigger font (used by `vr-term`, `vr-workspace`) |
| `spotify-vr` | Spotify (Flathub) inside `cage`, so WayVR's requested size applies |
| `chrome-vr` | Chrome with a separate VR profile, so it opens in VR, not the desktop |
| `vr-fix` | WayVR hung / black: kill, restart, reopen the workspace when the headset is on |
| `vr-hand-bindings` | write hand-tracking bindings that act like controllers |

`vr-term`, `vr-ready` and `vr-workspace` call `wayvrctl` from `PATH`.

## 2. Make WiVRn start WayVR on connect

```bash
python3 - <<'PY'
import json, os
p = os.path.expanduser("~/.var/app/io.github.wivrn.wivrn/config/wivrn/config.json")
d = json.load(open(p))
d["application"] = [os.path.expanduser("~/.local/bin/wayvr"), "--replace", "--show", "--headless"]
json.dump(d, open(p, "w"), indent=2)
PY
```

- The Flatpak build wraps it in `flatpak-spawn --host` **by itself** when it has
  `org.freedesktop.Flatpak=talk` (it does; verified in WiVRn's `start_application.cpp`), so the
  host binary runs. Do not add `flatpak-spawn` yourself.
- **`--show` is required**: without it WayVR starts with every panel hidden and the user sees
  nothing.
- **`--headless`** = apps-only, no monitor capture (no portal prompt, less load). Drop it to mirror
  the monitor; the first non-headless start pops a GNOME **"Share screen"** dialog *on the laptop*,
  which must be answered or the VR view stays empty.
- Config is read at server start; restart `wivrn-server` after editing.

## 3. USB (adb)

`vr-start` runs `adb reverse tcp:9757 tcp:9757` and opens the client with the intent
`wivrn+tcp://localhost` (package autodetected, e.g. `org.meumeu.wivrn`). Wi‑Fi needs no adb.

**Trap — `unauthorized` with no prompt in the headset.** The approval is per *key file*
(`~/.android/adbkey`), and a previous "Always allow" can be lost (headset update, another PC,
or the user approved the *"Allow access to data?"* prompt instead). Restarting adb and replugging did
not bring the prompt back. **What fixed it:** in the headset, developer settings
(Settings → Advanced → Developer, or search "developer") → **USB debugging off, then on** → replug →
**Always allow** → **Allow**. Heavier reset: Meta Horizon phone app → Devices → Headset settings →
Developer mode off/on.

There is no "Connect via USB" button in the headset; that button is in the PC-side WiVRn dashboard.

## 4. Hand tracking

- WiVRn forwards Quest hands (`ext_hand_interaction_enabled: true` in the server log). Turn on hand
  tracking + auto-switch in the Quest's Movement tracking settings.
- WayVR's default hand profile binds only the pinches with **no pose**: the watch never
  follows the wrist and nothing points. Run **`vr-hand-bindings`**, then restart WayVR.
  Result: a ray from each hand, the watch on the left wrist, **right pinch = click**,
  **left pinch = grab**.
- **Do not bind grab to `grasp_ext`**: pointing curls the other fingers, grasp fires, and screens
  get grabbed and thrown away.
- `handsfree_pointer` in `~/.config/wayvr/conf.d/zz-saved-config.json5` is the fallback when no
  hand/controller pose is bound: `Hmd` = head aim + pinch (Quest 3 has no eye tracking).
- Resizing and pushing a panel far away need a controller: grip = grab; grip + stick = distance;
  grip + trigger + stick = size. Hands alone can move panels only.

## 5. Apps-only workflow

- Hide panels so they don't open at startup: in `~/.config/wayvr/conf.d/zz-saved-state.json5`,
  move entries such as `eDP-1` (monitor) and `kbd` (virtual keyboard) from `sets[].overlays` to
  `sets[].hidden_overlays`. **Stop WayVR before editing**: it can save state over your edit.
- Open apps: the watch's dashboard App Launcher, or
  `wayvrctl process-launch -n NAME /abs/exe WxH anchored`. `wayvrctl` cannot pass `-o …` style
  args, so wrap them in a script (as `alacritty-vr` does). Native Wayland apps work.
  `xwayland-satellite` must be installed for X11 apps in Native mode; Cage mode works without it.
- Alacritty works. Untested theory: single-instance D-Bus apps (Ptyxis, GNOME Terminal) may open
  their window on the desktop instead of in VR.
- Clipboard does **not** sync with GNOME: WayVR needs `ext_data_control_manager_v1`, which Mutter
  lacks.
- **WayVR applies the requested size only to processes it launched itself**, matched by PID
  (`backend/wayvr/mod.rs`). A Flatpak app's window comes from a sandboxed child PID, so the log
  says `External process ID … connected` and the window gets WayVR's **1920×1080** default; the
  app's own saved size is ignored as well. Fix: run it inside **`cage`** (`dnf install cage`):
  `exec cage -- flatpak run …` keeps the launched PID, WayVR sizes cage, and the app fills cage's
  output. Verified: Spotify at 800×600. Non-Flatpak apps (Alacritty) take the size directly; Chrome
  also restores its own `window_placement` from its profile's `Preferences`.
- Single-instance apps (Spotify, Chrome per profile) hand a new launch to the running copy and
  exit, so close the old one first, or nothing new opens (with cage, cage exits too).
- Window size is capped at **2560×1440** (`WAYVR_SCREEN_RES` in `backend/wayvr/mod.rs`, a
  constant): a 1080×1920 request opens as 1080×1440. The tallest portrait is 1440 high.
- `wayvrctl show-hide` twice = hide then show the set, which re-places it in front of you. Quest
  recenter: hold the Meta button, or palm-up pinch-hold on the Meta icon.
- Apps can't be placed at exact positions from the CLI; place them by grabbing.

### Remembering the layout

WayVR saves panel positions (`saved_transform` per overlay in `zz-saved-state.json5`) only
**on a clean exit** or **when leaving Edit mode after a change** (`windowing/manager.rs`,
`persist_layout`). A `kill -9` of a hung WayVR saves nothing, which is why positions seemed to be
"forgotten". So: watch → **Edit mode** → arrange → **Edit mode** off = saved immediately.

Positions are keyed by the overlay **name**, which for apps is the window title at creation
(seen: `Alacritty`, `Spotify Premium`, `New Tab - Google Chrome`). A second copy of the same app is
deduplicated under another name and opens at the default spot, so `vr-workspace` skips apps
already running. Untested: an app whose first title differs between launches (Chrome restoring a
session) may not get its spot back.

WayVR restores *where* apps go, not *that* they open. `vr-workspace` opens them; `vr-start` and
`vr-fix` run it in the background, and it waits for `vr-ready`.

### Typing into VR apps with the physical keyboard

Set `"wvr_input_capture": "Evdev"` (user must be in the `input` group). Then — order matters,
verified in WayVR's `input_capture.rs` / `backend/wayvr/mod.rs`:

1. **Super+Z** → grabs keyboard/mouse (sound + notification). Grabbing *clears* window focus.
2. **Focus a VR window**: pinch-click it, or hold **Super+X**, aim with the head, release.
3. Type. **Super+Z** again returns input to the desktop.

While grabbed with **no** VR window focused, WayVR forwards keys back to the **desktop** via
uinput, so typing lands in whatever desktop window was active. While Super+X is held, letter keys
are VR controls (W click, Q/A grab, E edit mode, D dashboard, R show/hide, T keyboard, 1–6 sets),
not text.

## 6. Known bugs and traps

- **WayVR hangs after the headset comes off** (WayVR v26.8.0 + WiVRn 26.9): WiVRn stops the
  session, WayVR stops answering IPC and the headset shows black when worn again. `vr-fix`
  recovers. VR apps die with it.
- **`wayvrctl` gets no reply while the headset is off** (WayVR not `FOCUSED`), so launches
  silently fail. Wait with `vr-ready`, which polls IPC. **Do not wait on log lines**: when WiVRn
  launches WayVR, WayVR writes into the WiVRn server log, so `~/.local/state/wayvr-manual.log`
  can hold a stale `FOCUSED` from a dead instance.
- **Never launch WayVR yourself while WiVRn is also about to.** WiVRn starts it with `--replace`
  on connect; a second launch replaces the first and kills apps already open in it. `vr-start`
  therefore has no "start WayVR if WiVRn didn't" fallback.
- After many disconnects the WiVRn server can stop accepting the headset
  (`Exception while connecting headset: Socket shutdown`, WiVRn open on the headset but nothing
  happens). Cold start: kill WayVR, `flatpak kill io.github.wivrn.wivrn`,
  `adb shell am force-stop <wivrn package>`, then `vr-start`.
- **`pgrep -f PATTERN` inside `bash -c` matches its own command line.** That skipped a launch
  and killed a check script (exit 144). The scripts use `^`-anchored patterns on the binary path.
- Expected log noise: `Could not apply bindings for valve/frame_controller_valve` /
  `khr/generic_controller`, `missing translation for key "ALTTAB.KEYBOARD"`, SlimeVR socket
  warnings, `Missing XR_FB_composition_layer_alpha_blend`.

## 7. Quality and performance (measured on Intel UHD)

- Default stream was **1280×1344 per eye, H.264 VAAPI, 24.6 Mbit/s**. In the **headset's WiVRn
  app** settings the user turned **foveated encoding off** (and raised quality there), giving
  **1792×1856 per eye at 35.5 Mbit/s**, ~87% of the Quest 3's 2064×2208 per axis. Foveation is
  fixed-center on a Quest 3 (no eye tracking), so it blurs side panels; off is better for desktop
  work if the iGPU keeps up.
- "vaapi" **is** the Intel GPU's hardware encoder; `h264`/`h265` is only the codec. This GPU
  (Raptor Lake UHD) encodes H.264 and HEVC (`vainfo`), not AV1. Codec is set in the PC's
  `config.json` (`"encoder": {"encoder": "vaapi", "codec": "h265"}`), applied on server restart.
  The user switched to **h265**; the log then shows `vaapi (h265 8-bit)` at the same size and
  bitrate. Whether it looks better was not reported.
- If the encoder can't keep up: lower the headset refresh rate (72 Hz) before resolution.
- 20 panels: RAM is the limit (16 GB laptop had ~6 GB free), not CPU or the stream. Plan
  ~6–10 panels, mostly 1080p/720p; idle Wayland panels cost almost nothing.
- `vr-term` opens a tall terminal (1080×1920, font 15), which the user asked for to read text
  at eye level.

## Honesty rules

- **Passthrough is unverified.** `use_passthrough: true` is set in WayVR and no WiVRn option is
  needed per its docs, but no session has shown passthrough working. Ask the user what the
  background looks like before claiming it.
- Do not claim the exact headset menu names for WiVRn's resolution/bitrate settings; they were not
  checked.
- Do not claim WayVR can create extra virtual monitors on GNOME; nothing found supports that.
