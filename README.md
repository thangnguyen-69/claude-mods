# claude-mods

A [Claude Code](https://claude.com/claude-code) plugin marketplace.

## Install a mod

```
/plugin install <mod> --marketplace thangnguyen-69/claude-mods
```

Answer `y` to `Add marketplace?`, then pick the scope — the user scope loads the
mod in every session started from then on.

## What is in here

| Mod | What it does |
| --- | --- |
| [`plannotator-tailnet`](./plannotator-tailnet) | Publishes *this* Claude session's live [Plannotator](https://github.com/backnotprop/plannotator) reviews on your tailnet, so a plan or a diff can be reviewed from a phone — and puts the review's URL above the prompt as a hyperlink while it lives. |
| [`pr-links`](./pr-links) | Pins the pull/merge request a command just printed — `gh pr create`, `tea pr create`, `glab mr create`, an Azure DevOps `pullrequest` URL — as a clickable link on the hint line, so the URL is there without scrolling back for it. Any forge, by URL shape; no token, no configuration. |
| [`implement-beads`](./implement-beads) | Works through a [beads](https://github.com/gastownhall/beads) epic unattended: per bead, an implementer teammate does the work and a separate judge teammate verifies every acceptance criterion before the bead can pass. Teammates run as named Claude sessions in herdr panes. |
| [`human-review`](./human-review) | `/human-review`: you and Claude iterate on a change in Plannotator until you approve. Every annotation gets a verdict and goes back to you as a one-click question with its scope spelled out; Claude applies only what you chose, verifies, pushes and reopens the diff. Works from a phone with `plannotator-tailnet`. |

Each mod has its own README with requirements and design notes.

## Adding a mod

Write the mod under its own folder, with `.claude-plugin/plugin.json` inside it,
then list it here:

```json
{
  "name": "my-mod",
  "source": "./my-mod",
  "description": "One line for the install picker"
}
```

Push, and `/plugin install my-mod --marketplace thangnguyen-69/claude-mods`
picks it up — no re-release of the others needed.
