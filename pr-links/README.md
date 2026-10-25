# pr-links

Shows the pull/merge request this session's commands print, as a clickable link
on the hint line under the prompt, so it is there without scrolling the
transcript for it.

## Install

```
/plugin install pr-links --marketplace thangnguyen-69/claude-mods
```

Answer `y` to `Add marketplace?`, then choose the user scope to load it in every
session. It needs nothing else — no token, no forge configuration.

## What it does

Hooks `tool.call` for `Bash`. When a command's output names a pull request URL,
the newest one is drawn on the hint line as a `Link` — `PR #27`, opening the
forge. Older ones are remembered (up to five) and counted as `+2` so
a session that opened several keeps the trail.

`next(e)` is drawn beside the link rather than replaced: that tree is the
engine's own hint line, and dropping it would trade one useful line for another.

It is not a status-line entry. Terminals do support OSC 8, but putting the
sequence into `$.ui.status` makes the engine echo the raw escape bytes back as a
`⚠ <plugin>: …` line **on every repaint**. A render tree's `Link` element is
drawn and escaped by the engine, so nothing reaches a text field.

Recognised by URL *path shape*, not by hostname, so a self-hosted forge works
with no configuration:

| forge | path |
|---|---|
| GitHub, Gitea, Forgejo | `/owner/repo/pull/123` |
| GitLab | `/owner/repo/-/merge_requests/123` |
| Bitbucket | `/owner/repo/pull-requests/123` |
| Azure DevOps | `/org/project/_git/repo/pullrequest/123` |

An OSC 8 hyperlink is unwrapped first, because `tea pr create` prints its URL
inside one.

Note `tea pr <n>` and `tea pulls` print a summary table with **no URL**, so
those commands never trigger it — only output that actually names a link does.

## Commands

- `/pr` — toggle the link off and on. With nothing recorded yet, it says so
  instead of hiding a link that does not exist.

## What it does not do

- It never calls a forge API and needs no token: it only reads what a command
  already printed.
- It does not know a PR was merged or closed; the link keeps the last URL it saw
  until `/pr` hides it or the session ends.
- An errored Bash call is ignored even if its text contains a URL, so a failed
  create does not pin a link that was never made.
- **The label is only clickable where Claude Code draws hyperlinks.** It gates
  on a hardcoded `TERM_PROGRAM` allow-list, so a terminal it does not recognise
  (herdr among them) gets the fallback: the label followed by the URL in dim.
  `FORCE_HYPERLINK=1` in settings `env` overrides that, at the cost of being
  global to every hyperlink and needing a restart.

## Persistence

Links are written to the plugin's own `$.store` under `links:<session id>` on
every change and read back on `session.start`, so they survive a resume.
`$.state` alone would not: it survives a hot reload of the code, not a new
process. Keying by session id keeps one thread's links out of another's, and a
stored value from an older version is shape-checked before it is trusted.

## State

One key, `pr-links.prLinks`, declared in `types/index.d.ts`: the remembered
links newest-first and whether `/pr` hid the link.
