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
