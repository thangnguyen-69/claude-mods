import type { Engine, Register } from 'claude-code'

import type { StatusEntry } from '../types'

/**
 * Publishes *this* Claude session's live Plannotator reviews on the tailnet.
 *
 * Plannotator binds its review UI to a random loopback port and opens
 * `http://localhost:<port>`, which is useless from a phone or another machine.
 * This mod watches `plannotator sessions --json` and, for every live session
 * this Claude session started, runs
 *
 *   tailscale serve --bg --https=<port + 1000> http://127.0.0.1:<port>
 *
 * so the same review opens at `https://<host>.<tailnet>.ts.net:<port + 1000>`,
 * and writes this session's reviews (localhost and tailnet URL) to
 * `~/.claude/plannotator-tailnet/<session id>.json`, which the person's status
 * line command draws as links for as long as the review lives.
 *
 * The tailnet listener gets a port of its own rather than the review's: see
 * `SERVE_OFFSET`. And a link is shown only once a request to it has answered —
 * `tailscale serve status` prints a reservation that failed, so it is not
 * evidence that the URL loads (see `serves`).
 *
 * Only this session's own reviews. The `sessions/` registry is machine-wide:
 * every concurrent Claude session would otherwise publish, display and toast
 * the others' reviews. A session tells its own apart by the
 * `PLANNOTATOR_SESSION_TAG` Plannotator's own mod writes into the environment
 * (`claude-code:<session id>`), which the registry records as `hostSession`.
 * A review whose tag is absent — one started from a shell, or by a host that
 * tags nothing — is nobody's here, and is left exactly as it was found.
 *
 * It unwinds only the mappings it published itself, and only once the session
 * behind them is gone: a port already served before a review appeared, or one
 * served to a different backend, is left alone.
 */

/** Where the status line command reads this session's reviews: `<dir>/<session id>.json`. */
const STATUS_DIR = '.claude/plannotator-tailnet'

/** The store key per session: what that session's own mappings are. */
const STORE_PREFIX = 'published:'
/** The one key the version before per-session publishing kept every mapping under. */
const LEGACY_KEY = 'plannotator-tailnet.published'
const TOOL = 'mcp__plannotator__plannotator'
const COMMAND = 'plannotator-tailnet'
const POLL_MS = 4000
/** Below this the HTTPS listener needs privileges this mod will not assume. */
const MIN_PORT = 1024
/** `tailscale serve --https=443` serves on the bare hostname, colliding with the person's own 443. */
const MAX_PORT = 65535

/**
 * How far above a review's own port its tailnet listener is put.
 *
 * Not the same port: `tailscale serve --https=<port>` cannot take a port that
 * another process binds on `0.0.0.0`, and Plannotator binds `0.0.0.0:<port>`
 * unless it was started with `PLANNOTATOR_REMOTE=0` — which is not this mod's
 * to choose, since the review is opened by Plannotator's own tool. Worse, the
 * reservation fails *silently*: `tailscale serve status` still prints the
 * mapping, so `serve` exits 0 and the URL looks published while every `https`
 * request to it dies with `wrong version number`.
 *
 * A port of its own avoids that whichever way the review was bound. Measured
 * 2026-10-25 on this machine: `0.0.0.0:<p>` served on `<p>` gave `000`,
 * `127.0.0.1:<p>` served on `<p>` gave `200`, and `0.0.0.0:<p>` served on
 * `<p>+1000` gave `200`.
 */
const SERVE_OFFSET = 1000

/**
 * The tailnet port a review is published on, or null when there is none it can
 * take: one past `MAX_PORT` would wrap onto the person's own listener.
 */
function publishPort(port: number): number | null {
  const candidate = port + SERVE_OFFSET
  return candidate > MIN_PORT && candidate <= MAX_PORT ? candidate : null
}

const proxyOf = (port: number) => `http://127.0.0.1:${port}`

type Ran = { isOk: boolean; stdout: string; stderr: string }

/** One host command; a child that cannot start, times out or exits nonzero is not an error here. */
async function run($: Engine, argv: string[], timeoutMs = 15000): Promise<Ran> {
  try {
    const { exitCode, stdout, stderr } = await $.process.run(argv, { timeoutMs })
    return { isOk: exitCode === 0, stdout, stderr }
  } catch {
    return { isOk: false, stdout: '', stderr: '' }
  }
}

const firstLine = (text: string) => text.trim().split('\n')[0] ?? ''

function lastLineOf(text: string): string {
  const lines = text.trim().split('\n')
  return lines[lines.length - 1]?.trim() ?? ''
}

/**
 * The `plannotator` binary, resolved once. A hooks worker inherits no shell
 * profile, so `PATH` alone is not enough and the usual install location is
 * tried too. Cached on success; `undefined` forces a fresh lookup.
 */
let exe: string | null | undefined

async function plannotatorExe($: Engine): Promise<string | null> {
  if (exe !== undefined) return exe

  const onPath = await run($, ['sh', '-lc', 'command -v plannotator'], 10000)
  if (onPath.isOk && onPath.stdout.trim() !== '') {
    exe = firstLine(onPath.stdout)
    return exe
  }

  const home = await run($, ['sh', '-lc', 'printf %s "$HOME"'], 10000)
  const beside = home.isOk && home.stdout.trim() !== '' ? `${home.stdout.trim()}/.local/bin/plannotator` : null
  if (beside !== null && (await run($, [beside, '--version'], 10000)).isOk) {
    exe = beside
    return exe
  }

  return null
}

type Live = {
  /** `claude-code:<session id>` of the session that started it; empty when nothing tagged it. */
  hostSession: string
  /** The loopback URL Plannotator opened. */
  url: string
  /** What the status line calls it: `<project> (<mode>)`. */
  label: string
}

/** Live review sessions by port, each with the tag of the session that started it. */
async function liveSessions($: Engine): Promise<Map<number, Live>> {
  const live = new Map<number, Live>()
  const binary = await plannotatorExe($)
  if (binary === null) return live

  const listed = await run($, [binary, 'sessions', '--json'], 10000)
  if (!listed.isOk) return live

  let parsed: unknown
  try {
    parsed = JSON.parse(listed.stdout)
  } catch {
    return live
  }
  if (!Array.isArray(parsed)) return live

  for (const entry of parsed as Record<string, unknown>[]) {
    const port = entry?.['port']
    if (typeof port !== 'number' || !Number.isInteger(port)) continue
    if (port < MIN_PORT || port > MAX_PORT) continue
    const tag = entry['hostSession']
    const url = entry['url']
    const project = entry['project']
    const mode = entry['mode']
    live.set(port, {
      hostSession: typeof tag === 'string' ? tag : '',
      url: typeof url === 'string' ? url : `http://localhost:${port}`,
      label: `${typeof project === 'string' ? project : `:${port}`}${typeof mode === 'string' ? ` (${mode})` : ''}`,
    })
  }

  return live
}

/**
 * This Claude session's own tag, in the spelling the registry uses.
 *
 * Read at every sync rather than kept: `/clear` ends the conversation and
 * starts a new session id in the same process, with no `session.start` to
 * hear it. `null` when the host will not say — then nothing is this
 * session's, and nothing is published.
 */
async function ownTag($: Engine): Promise<string | null> {
  try {
    const id = await $.session.id()
    return id === '' ? null : `claude-code:${id}`
  } catch {
    return null
  }
}

/** The ports a session's own store entry holds. */
async function storedPorts($: Engine, key: string): Promise<Set<number>> {
  const stored = await $.store.get(key)
  if (!Array.isArray(stored)) return new Set()
  return new Set(stored.filter((port): port is number => typeof port === 'number'))
}

/**
 * Lists this machine's MagicDNS name among the hostnames a Plannotator server
 * answers on.
 *
 * `tailscale serve` forwards the browser's own `Host: <machine>.<tailnet>.ts.net`
 * to a loopback server, and the server's Host allowlist refuses an unknown name
 * with `403 host_not_allowed`. The env is read once, when a server starts, so
 * this is set as early as the session allows; a server that started before the
 * session did is covered by the value in the user's own `settings.json`.
 */
async function allowTailnetHost($: Engine): Promise<void> {
  try {
    const status = await run($, ['tailscale', 'status', '--json'], 10000)
    if (!status.isOk) return

    let parsed: unknown
    try {
      parsed = JSON.parse(status.stdout)
    } catch {
      return
    }

    const dns = (parsed as { Self?: { DNSName?: unknown } } | null)?.Self?.DNSName
    if (typeof dns !== 'string' || dns === '') return
    const host = (dns.endsWith('.') ? dns.slice(0, -1) : dns).toLowerCase()
    if (host === '') return

    const current = await $.env.get('PLANNOTATOR_ALLOWED_HOSTS')
    const names = (current ?? '')
      .split(',')
      .map(name => name.trim().toLowerCase())
      .filter(name => name !== '')

    if (names.includes('*') || names.includes(host)) return

    await $.env.set('PLANNOTATOR_ALLOWED_HOSTS', [...names, host].join(','))
  } catch {
    // A host without tailscale, or an env the engine refuses: the person's
    // settings.json is the other half of this, and the publish still runs.
  }
}

type Servings = { host: string; byPort: Map<number, string> }

/** What `tailscale serve` holds now: HTTPS port to proxy target. `null` when tailscale cannot be read. */
async function serveStatus($: Engine): Promise<Servings | null> {
  const status = await run($, ['tailscale', 'serve', 'status', '--json'], 10000)
  if (!status.isOk) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(status.stdout)
  } catch {
    return null
  }

  const web = (parsed as { Web?: unknown } | null)?.['Web']
  const byPort = new Map<number, string>()
  let host = ''

  if (web !== null && typeof web === 'object') {
    for (const [key, value] of Object.entries(web as Record<string, unknown>)) {
      const colon = key.lastIndexOf(':')
      if (colon === -1) continue

      const port = Number(key.slice(colon + 1))
      if (!Number.isInteger(port)) continue

      if (host === '') host = key.slice(0, colon)

      const handlers = (value as { Handlers?: unknown } | null)?.['Handlers']
      const proxy =
        handlers !== null && typeof handlers === 'object'
          ? ((handlers as Record<string, { Proxy?: unknown }>)['/']?.Proxy)
          : undefined

      if (typeof proxy === 'string') byPort.set(port, proxy)
    }
  }

  return { host, byPort }
}

type Report = { published: string[]; serving: string[]; unpublished: number[]; skipped: string[] }

function urlFor(host: string, port: number): string {
  return port === 443 ? `https://${host}/` : `https://${host}:${port}/`
}

/**
 * Takes down the mapping standing on `served`, but only while it still points
 * where this mod put it.
 *
 * The port is derived rather than chosen, so it can be one the person is
 * already serving something else on: that mapping is theirs and stays.
 */
async function unpublish($: Engine, status: Servings, reviewPort: number): Promise<boolean> {
  const served = publishPort(reviewPort)
  if (served === null) return false
  if (status.byPort.get(served) !== proxyOf(reviewPort)) return false
  reachable.delete(served)
  return (await run($, ['tailscale', 'serve', `--https=${served}`, 'off'], 10000)).isOk
}

/**
 * The tailnet ports this mod has seen serve, so a live review is not re-probed
 * on every tick. A publish drops its own entry first, so a re-publish re-checks.
 */
const reachable = new Set<number>()

/** A tailnet address as `ss` prints it: IPv4 in 100.64.0.0/10, or IPv6 in fd7a:115c:a1e0::/48 (bracketed). */
const TAILNET_ADDRESS = String.raw`(?:100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}|\[fd7a:115c:a1e0:[0-9a-f:]*\])`

/**
 * Whether `tailscale serve` has really taken `port` on the tailnet.
 *
 * `tailscale serve status` is not evidence: a reservation that fails still
 * prints, so a link built from it looks published while every request to it
 * dies with `wrong version number`. What does settle it is the listener the
 * tailscaled side creates — `ss` shows
 * `<tailscale-ip>%tailscale0:<port>` (or `<tailscale-ip>:<port>` on WSL2,
 * which prints no interface) for a port that serves, and nothing for
 * one whose reservation silently failed. That is a local read, so it needs no
 * network and cannot be refused by the host's fetch policy:
 * `$.http.fetch` to the tailnet URL is refused outright in some sessions,
 * which would withhold a link that works.
 *
 * `ss` absent, or its output unreadable, is reported as not serving — the
 * localhost link is still drawn, and a missing tailnet link is recoverable
 * where a link that never loads is what gets reported as broken.
 */
async function serves($: Engine, port: number): Promise<boolean> {
  if (reachable.has(port)) return true

  const listing = await run($, ['ss', '-ltn'], 10000)
  if (!listing.isOk) return false

  // `<addr>%tailscale0:<port>`, or the tailnet address alone where `ss` prints
  // no interface (WSL2: `100.x.y.z:<port>`). The anchor matters: the review's
  // own `0.0.0.0:<port>` listener is a different, useless line that matches on
  // a bare port search, so a line without the interface counts only when its
  // address is a tailnet one (100.64.0.0/10 or fd7a:115c:a1e0::/48).
  const listener = new RegExp(`(?:\\S*%tailscale0|(?<![\\w.:])${TAILNET_ADDRESS}):${port}\\s`)
  if (!listener.test(listing.stdout)) return false

  reachable.add(port)
  return true
}

/**
 * Removes the mappings a session that has ended left standing.
 *
 * An ended session cannot tidy up after a review it left open — that review
 * keeps running, and its mapping must outlive the session that opened it. So
 * whichever session is running next takes it down once the review behind it
 * is gone too. A key with nothing left in it is dropped, so the store does
 * not grow one entry per session ever run.
 */
async function reapOrphans($: Engine, status: Servings, live: Map<number, Live>, ownKey: string): Promise<void> {
  for (const key of await $.store.keys()) {
    if (!key.startsWith(STORE_PREFIX) || key === ownKey) continue

    const kept: number[] = []
    for (const port of await storedPorts($, key)) {
      if (live.has(port)) {
        kept.push(port)
        continue
      }
      await unpublish($, status, port)
    }

    if (kept.length > 0) await $.store.set(key, kept)
    else await $.store.delete(key)
  }
}

/**
 * Re-files the mappings a version that published every session's reviews kept
 * under one key of its own, once, into the per-session entry each one belongs
 * to, and drops the old key.
 *
 * Ownership is the registry's to say, so a review still live goes to the
 * session that started it and is torn down by that session from then on —
 * under an empty owner when nothing tagged it, which any session then reaps
 * once the review ends. One whose review has already gone is taken down here:
 * nothing would ever claim it again.
 */
async function adoptLegacy($: Engine, status: Servings, live: Map<number, Live>): Promise<void> {
  if ((await $.store.get(LEGACY_KEY)) === undefined) return

  for (const port of await storedPorts($, LEGACY_KEY)) {
    const owner = live.get(port)?.hostSession

    if (owner !== undefined) {
      const key = STORE_PREFIX + owner
      const held = await storedPorts($, key)
      held.add(port)
      await $.store.set(key, [...held])
      continue
    }

    // Still pointing where this plugin put it, or it is not ours to remove.
    await unpublish($, status, port)
  }

  await $.store.delete(LEGACY_KEY)
}

/** `$HOME`, resolved once; null when the host will not say. */
let home: string | null | undefined

async function homeDir($: Engine): Promise<string | null> {
  if (home !== undefined) return home
  const out = await run($, ['sh', '-lc', 'printf %s "$HOME"'], 10000)
  home = out.isOk && out.stdout.trim() !== '' ? out.stdout.trim() : null
  return home
}

/** The status file's last content, so a sync that changed nothing writes nothing. */
let written: { path: string; text: string } | undefined

/**
 * What the band draws: every live review of this session's, newest first.
 *
 * Held in the module rather than `$.state` because only the render hook reads
 * it and only `writeStatus` writes it — one writer, one reader, no subscription
 * to set up. A hot reload re-evaluates the module, and the next sync fills it
 * in again.
 *
 * Every entry, not `entries[0]`: a session can have several reviews live at
 * once, and drawing one of them silently hid the rest. `pr-links` had the same
 * defect and the same fix.
 */
let live: StatusEntry[] = []

/** Whether two lists would draw the same rows, so a no-op sync repaints nothing. */
function sameEntries(a: readonly StatusEntry[], b: readonly StatusEntry[]): boolean {
  return a.length === b.length && a.every((entry, i) => entry.local === b[i]?.local && entry.label === b[i]?.label && entry.tailnet === b[i]?.tailnet)
}

/** Writes this session's reviews for the status line command; an empty list when none is live. */
async function writeStatus($: Engine, tag: string | null, entries: StatusEntry[]): Promise<void> {
  // The band is fed here too: this is the one place a sync's list of live
  // reviews arrives, so the two views cannot disagree.
  const changed = !sameEntries(live, entries)
  live = entries
  if (changed) $.ui.invalidate('ui.render')

  if (tag === null) return
  const dir = await homeDir($)
  if (dir === null) return
  const path = `${dir}/${STATUS_DIR}/${tag.slice('claude-code:'.length)}.json`
  const text = JSON.stringify(entries) + '\n'
  if (written?.path === path && written.text === text) return
  try {
    await $.fs.write(path, text)
    written = { path, text }
  } catch {
    // An fs hook or the OS refused: the next sync tries again.
  }
}

/** Brings `tailscale serve` in line with this session's own live reviews, and reports what changed. */
async function sync($: Engine, announce: boolean): Promise<Report> {
  const report: Report = { published: [], serving: [], unpublished: [], skipped: [] }

  const status = await serveStatus($)
  if (status === null) {
    report.skipped.push('tailscale serve is unreadable')
    return report
  }

  const tag = await ownTag($)
  const live = await liveSessions($)
  const key = STORE_PREFIX + (tag ?? '')

  await adoptLegacy($, status, live)

  const mine = tag === null ? [] : [...live.entries()].filter(([, entry]) => entry.hostSession === tag)
  const ours = tag === null ? new Set<number>() : await storedPorts($, key)

  // Publish every one of this session's reviews not served yet. A port already
  // bound to something else is the person's: neither taken over nor adopted,
  // since only a mapping this mod made is ever in `ours`, and only `ours` is
  // ever removed.
  const shown: StatusEntry[] = []
  for (const [port, entry] of mine) {
    const served = publishPort(port)
    if (served === null) {
      shown.push({ label: entry.label, local: entry.url })
      report.skipped.push(`:${port} has no tailnet port of its own`)
      continue
    }

    const held = status.byPort.get(served)
    if (held !== undefined) {
      if (held === proxyOf(port)) {
        // Published by this mod already — by this session, or by one whose
        // entry has since gone. Either way it is the mapping a live review of
        // this session's wants, so it is adopted rather than duplicated.
        ours.add(port)
        if (!(await serves($, served))) {
          // Reserved but not answering: take it down so the retry below
          // republishes, instead of showing a link that never loads.
          reachable.delete(served)
          await run($, ['tailscale', 'serve', `--https=${served}`, 'off'], 10000)
          report.skipped.push(`:${served} was reserved but does not answer; republishing`)
        } else {
          report.serving.push(urlFor(status.host, served))
          shown.push({ label: entry.label, local: entry.url, tailnet: urlFor(status.host, served) })
          continue
        }
      } else {
        shown.push({ label: entry.label, local: entry.url })
        report.skipped.push(`:${served} already serves ${held}`)
        continue
      }
    }

    const started = await run($, ['tailscale', 'serve', '--bg', `--https=${served}`, proxyOf(port)])
    if (!started.isOk) {
      report.skipped.push(`:${served} ${lastLineOf(started.stderr) || 'serve failed'}`)
      shown.push({ label: entry.label, local: entry.url })
      continue
    }

    ours.add(port)
    // The link is only written once the listener answers: a reservation `serve`
    // accepted is not proof it serves.
    if (await serves($, served)) {
      report.published.push(urlFor(status.host, served))
      shown.push({ label: entry.label, local: entry.url, tailnet: urlFor(status.host, served) })
    } else {
      report.skipped.push(`:${served} reserved but not answering yet`)
      shown.push({ label: entry.label, local: entry.url })
    }
  }

  // Unwind this session's mappings once the review behind them has ended.
  // Plannotator's own session list is the authority on that, not this session's
  // end: a review usually outlives the turn that opened it.
  for (const port of [...ours]) {
    if (live.has(port)) continue
    if (await unpublish($, status, port)) {
      ours.delete(port)
      report.unpublished.push(port)
    }
  }

  if (tag !== null) await $.store.set(key, [...ours])

  await reapOrphans($, status, live, key)

  await writeStatus($, tag, shown)

  if (announce && (report.published.length > 0 || report.serving.length > 0)) {
    const urls = [...report.published, ...report.serving]
    $.ui.toast(`Plannotator on the tailnet: ${urls.join('  ')}`, { timeoutMs: 15000 })
  }

  return report
}

/** The poll's timer, and the chain that keeps two syncs from reading the host at once. */
let tick: { cancel: () => void } | undefined
let queue: Promise<unknown> = Promise.resolve()
let isBusy = false

async function syncOnce($: Engine, announce: boolean): Promise<Report | undefined> {
  const queued = queue.then(async () => {
    isBusy = true
    try {
      return await sync($, announce)
    } catch {
      // A host without tailscale, or a store that refused: the next tick tries again.
      return undefined
    } finally {
      isBusy = false
    }
  })

  queue = queued
  return queued
}

export const register: Register = (on, options) => {
  // Drawn in the band directly above the prompt, not on the hint line under it.
  //
  // `PromptHint` is a single line shared by every plugin — each one composes its
  // tree around `next(e)` — so a review link there competes for the same row as
  // everything else that draws one, and cannot show more than a line's worth.
  // `AbovePrompt` is its own multi-row site with `maxRows` and scrolling, which
  // is what a list of live reviews needs. The desktop sidebar keeps the hint
  // line to itself as a result.
  //
  // 0.3.0 wrote the JSON and left a `statusLine` command to draw it, but a
  // plugin cannot ship that key (the manifest rejects `statusLine`) and
  // `$.settings` is read-only, so every install needed a hand-written command
  // plus this machine's own session-id path. A render hook is portable: it
  // installs with the plugin and needs nothing of the person's settings.
  //
  // One row per review, each labelled with the review's own `<project> (<mode>)`
  // and its transport: the old line said only `tailnet`/`local`, which named how
  // to reach a review but not which one it was. A `Link` still needs a label — a
  // bare one draws the whole URL, longer than the rest of the row.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const drawn = await next(e)
    // A survey owns the band while it is up; drawing under it would stack two
    // unrelated things in the same place.
    if (live.length === 0 || e.props.hasSurvey) return drawn

    const { Box, Link, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {drawn as never}
        {/* One row per review rather than one run of links: the band is a list,
            and a wrapped run would not say where one review ends. */}
        {live.map(entry => {
          const tailnet = entry.tailnet !== undefined
          return (
            <Box key={entry.local} flexDirection="row">
              <Text dimColor>review </Text>
              <Link href={tailnet ? entry.tailnet! : entry.local} label={`${entry.label} · ${tailnet ? 'tailnet' : 'local'}`} />
            </Box>
          )
        })}
      </Box>
    )
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: "Publish this session's live Plannotator reviews on the tailnet",
    })

    await allowTailnetHost($)

    tick ??= $.clock.every(POLL_MS, () => {
      if (!isBusy) void syncOnce($, false)
    })
    void syncOnce($, false)

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    tick?.cancel()
    tick = undefined

    // This session is going away, but a review it opened may still be open:
    // sync sees that in `plannotator sessions` and keeps the mapping, and the
    // entry it leaves behind is the next session's to reap.
    await syncOnce($, false)

    return next(e)
  })

  on('tool.call', { tool: TOOL }, async ($, e, next) => {
    const ran = await next(e)

    // The call worked, so any earlier failed lookup of the binary was wrong.
    exe = undefined
    await syncOnce($, true)

    return ran
  }).catch(($, e, next) => next(e))

  on('command.run', { command: COMMAND }, async ($, e) => {
    if (e.args.trim() === 'off') {
      const tag = await ownTag($)
      const key = STORE_PREFIX + (tag ?? '')
      const ours = tag === null ? [] : [...(await storedPorts($, key))]
      const status = await serveStatus($)

      const stopped: number[] = []
      for (const port of ours) {
        if (status !== null && (await unpublish($, status, port))) stopped.push(port)
      }
      if (tag !== null) await $.store.delete(key)
      await writeStatus($, tag, [])

      return { text: stopped.length > 0 ? `Unpublished ${stopped.map(port => `:${port}`).join(', ')}.` : 'Nothing published.' }
    }

    // Asked for, this repairs the allowlist too: a session that began before
    // the line was in the person's settings has it for nothing it starts after
    // this call, and a review it opens next answers on the tailnet name.
    await allowTailnetHost($)

    exe = undefined
    const report = await syncOnce($, true)
    if (report === undefined) return { text: 'Could not read tailscale serve status.' }

    const lines = [
      ...report.published.map(url => `published  ${url}`),
      ...report.serving.map(url => `serving  ${url}`),
      ...report.unpublished.map(port => `unpublished  :${port}`),
      ...report.skipped.map(note => `skipped  ${note}`),
    ]

    return { text: lines.length > 0 ? lines.join('\n') : 'No live Plannotator sessions of this session’s.' }
  }).catch(($, e, next) => next(e))
}
