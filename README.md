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
