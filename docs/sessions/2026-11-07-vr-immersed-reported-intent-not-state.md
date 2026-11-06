# The launcher searched a directory the installer never used

**Date:** 2026-11-07 · **Versions:** `vr-quest` 0.5.6 → 0.5.7

## The report

```
Wi-Fi 'HUY THINH APARTMENT': profile 'workstation' already active.
Immersed AppImage not found in ~/Applications
```

The AppImage was installed and had just been running. It was at
`~/.local/opt/immersed/Immersed-x86_64.AppImage`.

## Cause: the script and the docs disagreed

`vr-immersed` looked in exactly one place:

```bash
app=$(ls -t "$HOME"/Applications/Immersed*.AppImage "$HOME"/Applications/Immersed/*.AppImage 2>/dev/null | head -1)
```

But SKILL.md §1 installs to `~/.local/opt/immersed`, and the `.desktop` file it generates hardcodes
that same path. **The script could never find the installation the skill tells you to make.** The
`~/Applications` search only makes sense for AppImageLauncher, which moves and hash-renames the file.

`git log -L` puts the line in the initial commit (`28029a4`, vr-quest 0.4.0) and it was never touched
since — so this was not a regression from any recent work. It survived because on this host the
installed `~/.local/bin/vr-immersed` had been **hand-patched** to the right path, so the shipped bug
was never exercised.

## The part that is my fault

That hand-patch is gone because **I overwrote it**. Installing the 0.5.6 plugin, I ran
`install -Dm755 ... ~/.local/bin/vr-immersed` — a blind overwrite of a host-patched script. The skill
already said "if a same-named script already exists in `~/.local/bin`, diff it first", and I skipped
it. The launcher then fell back to the shipped path list and failed on the next invocation.

So this incident is really two bugs:

1. the shipped script searched the wrong directory, and
2. the shipped warning about overwriting local patches was too abstract to be followed.

## The fix

- `find_app()` searches `~/.local/opt/immersed`, `~/Applications` (flat and nested) and
  `~/Downloads`, and returns the **newest** match — so AppImageLauncher's hash-renamed copies still
  win when present.
- The not-found error lists every directory it searched, instead of naming the one that was wrong.
- §1 now diffs each existing `~/.local/bin` copy and prints the differences **before** the install
  loop, with this exact failure recorded next to it. The instruction to fold local fixes back into the
  repo — rather than re-patching the installed copy — is stated explicitly.

## Lesson

A locally patched script and an unpatched one look identical from the outside, and the patch is
invisible to `git status` because it lives in `~/.local/bin`, not the repo. Any "install the scripts"
step is a potential silent revert of a host fix, which makes the diff-before-overwrite step load-
bearing rather than polite. Two independent path sources (the script's search list and the documented
install location) drifting apart is what made the bug survive this long: the same information existed
twice and only one copy was edited.

---

# Follow-up: the inhibitor message was also lying

**Version 0.5.8.** Two consecutive `vr-immersed` runs produced different output:

```
run 1: Screen lock and suspend held off while Immersed runs.
run 2: (no such line)
```

Read at face value, run 2 says the protection had quietly stopped — and idle lock is a known
zero-copy killer, so that reading is alarming.

**It was the message, not the lock.** Verified directly:

```
gnome-session-inhibit ... --inhibit idle:suspend   <- process still alive (pid 1216956)
org.gnome.SessionManager.IsInhibited    flag 4 (suspend) -> True
org.gnome.SessionManager.IsInhibited    flag 8 (idle)    -> True
```

The script printed its confirmation inside the branch that *creates* the inhibitor, so on every
subsequent run — where the inhibitor already exists — it printed nothing at all.

## Getting the flag numbers right

The first attempt at checking this used the wrong enum and reported "idle = False, suspend = True",
which looks like a genuine half-broken inhibitor. The actual values are **logout=1, switch-user=2,
suspend=4, idle=8**; the initial query passed `1` and `8` and mislabelled them. Worth pinning down
before drawing a conclusion from a boolean whose meaning you guessed.

`ListInhibitors` is not exposed on this gnome-session (`UnknownMethod`), so the state has to be read
per-flag through `IsInhibited`. `gdbus` needs no Python:

```bash
gdbus call --session --dest org.gnome.SessionManager \
  --object-path /org/gnome/SessionManager \
  --method org.gnome.SessionManager.IsInhibited 8      # -> (true,)
```

`vr-immersed` now queries that and prints "held off" / "still held off", or a WARNING if idle is not
inhibited.

## Same failure mode as the AppImage bug

Three bugs in two commits, and all three are the same mistake: **reporting an intention instead of a
state.** "Started Immersed agent" without checking the process; "Screen lock held off" without
checking the inhibitor; and a search list that assumed where the file was rather than looking. A
helper script's output is read as fact, so every line that claims something happened should be backed
by a check that it did.
