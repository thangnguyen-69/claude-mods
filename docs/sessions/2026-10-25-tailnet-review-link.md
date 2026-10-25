# The tailnet review link that never served

**Date:** 2026-10-25 · **Versions:** `plannotator-tailnet` 0.4.0 → 0.5.1,
`pr-links` 0.1.0

## The report

`sire`: *"i still dont see any tailnet url in the bar in this session."* The mod
was running — it wrote its status file every 4 seconds — but nothing appeared
under the prompt, and the URLs it recorded answered `000`.

## Cause 1 — a link that was never served

`tailscale serve --https=<p>` cannot take a port that another process binds on
`0.0.0.0`. Plannotator binds `0.0.0.0:<p>` unless started `PLANNOTATOR_REMOTE=0`,
which the mod cannot choose: Plannotator's own tool opens the review. The
reservation then fails **silently** — `serve` exits 0, prints "Serve started",
and `tailscale serve status` still lists the mapping — while every `https`
request to it dies with `wrong version number`.

Measured on `thang-x600-itx`, same live review each time:

| backing bind | served on | tailnet answer |
|---|---|---|
| `0.0.0.0:19901` | `19901` | **000** |
| `0.0.0.0:19901` | `20901` | **200**, served the real `Code Review` UI |

Two independent fixes exist; either works:

1. Make the backing process bind loopback only (`PLANNOTATOR_REMOTE=0`).
2. Serve it on a different tailnet port — `<p>+1000` proxying to
   `http://127.0.0.1:<p>`.

Only (2) is available to a plugin, which does not start the process. 0.5.0 uses
offset `1000`. Because the port is *derived* rather than chosen, it can land on
one the person already serves, so `unpublish()` only removes a mapping still
pointing where the mod put it.

## Cause 2 — `serve status` is not evidence

The same silence means the mod's own check was worthless: it read
`tailscale serve status` and believed it. 0.5.0 fetches every tailnet link and
writes it only once the request answers. Any status counts — a `403` from
Plannotator's Host allowlist is a live listener just like a `200`. A reservation
that does not answer is torn down and republished; the localhost link covers the
gap.

## Cause 3 — the running process was three versions behind

The session had loaded `cache/claude-mods/plannotator-tailnet/**0.3.0**`, which
has **no `ui.render` hook at all** — nothing to draw a hint line. `0.4.0` had
installed successfully at 12:11, after the session started at 11:17.

Hot reload does **not** re-resolve a plugin's install path: touching a file in
the old folder re-evaluated the old module, still with no render hook. Only a
restart re-reads `installed_plugins.json`. Verified by counting the hook across
versions rather than assuming:

```
0.3.0: 0   (loaded by the session)
0.4.0: 2
0.5.0: 2
```

This is why "the new feature does not work" and "the new version is not loaded"
must be told apart **before** debugging the code.

## Cause 4 — an unlabelled `Link` draws the whole URL

`LinkProps.label` is optional and, absent, the URL itself is the text. The hint
line read ` review https://<host>.<tailnet>.ts.net:20951/` — the URL longer than
everything else on the row. 0.5.1 labels it `tailnet`, or `local` while only the
loopback URL is known.

## Also published

`pr-links` 0.1.0 — the PR/MR URL a command printed, as a clickable link on the
hint line. Any forge by URL *path shape* (GitHub/Gitea/Forgejo, GitLab,
Bitbucket, Azure DevOps), so a self-hosted forge needs no configuration. Links
live in `$.store` under `links:<session id>` and are restored on `session.start`,
because `$.state` survives only a hot reload, not a resume.

Added the MIT `LICENSE` the repo was missing — `LICENSE_MISSING` blocked every
directory submission — and wired both mods into the marketplace manifest.

## Verification

- `plannotator-tailnet`: 24/24 tests. The new tests were proved to bite:
  `SERVE_OFFSET = 0` fails 12; stubbing the reachability probe to `true` fails
  3; neither is a check that cannot fail.
- `pr-links`: 18/18 tests.
- `claude plugin validate` passes for both mods and the marketplace.
- Live: the old port answered `000`, the derived port `200` with the review UI
  title, twice, on two separate sessions.
- **Not verified:** 0.5.1 drawing in the UI. The running session still has
  0.3.0 loaded; that needs a restart.

## Correction to earlier notes

Memory `tailscale-serve-port-collision-with-0-0-0` previously stated that
`PLANNOTATOR_REMOTE=1` is "what forces the 0.0.0.0 bind". The trigger is **any**
`0.0.0.0` bind, whoever makes it, and the offset fix works without changing the
binder. That memory has been updated with the measurements above.
