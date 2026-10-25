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
 *   tailscale serve --bg --https=<port> http://127.0.0.1:<port>
 *
 * so the same review opens at `https://<host>.<tailnet>.ts.net:<port>`, and
 * writes this session's reviews (localhost and tailnet URL) to
 * `~/.claude/plannotator-tailnet/<session id>.json`, which the person's status
 * line command draws as links for as long as the review lives.
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
      // Still pointing where this plugin put it, or it is not ours to remove.
      if (status.byPort.get(port) !== proxyOf(port)) continue
      await run($, ['tailscale', 'serve', `--https=${port}`, 'off'], 10000)
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
    if (status.byPort.get(port) !== proxyOf(port)) continue
    await run($, ['tailscale', 'serve', `--https=${port}`, 'off'], 10000)
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
 * What the hint line draws: this session's newest live review, or null.
 *
 * Held in the module rather than `$.state` because only the render hook reads
 * it and only `writeStatus` writes it — one writer, one reader, no subscription
 * to set up. A hot reload re-evaluates the module, and the next sync fills it
 * in again.
 */
let hint: StatusEntry | null = null

/** Writes this session's reviews for the status line command; an empty list when none is live. */
async function writeStatus($: Engine, tag: string | null, entries: StatusEntry[]): Promise<void> {
  // The hint line is fed here too: this is the one place a sync's list of live
  // reviews arrives, so the two views cannot disagree.
  const newest = entries[0] ?? null
  const changed = hint?.local !== newest?.local
  hint = newest
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
    const held = status.byPort.get(port)
    if (held !== undefined) {
      if (held === proxyOf(port)) {
        report.serving.push(urlFor(status.host, port))
        shown.push({ label: entry.label, local: entry.url, tailnet: urlFor(status.host, port) })
      } else {
        shown.push({ label: entry.label, local: entry.url })
        report.skipped.push(`:${port} already serves ${held}`)
      }
      continue
    }

    const served = await run($, ['tailscale', 'serve', '--bg', `--https=${port}`, proxyOf(port)])
    if (!served.isOk) {
      report.skipped.push(`:${port} ${lastLineOf(served.stderr) || 'serve failed'}`)
      shown.push({ label: entry.label, local: entry.url })
      continue
    }

    ours.add(port)
    report.published.push(urlFor(status.host, port))
    shown.push({ label: entry.label, local: entry.url, tailnet: urlFor(status.host, port) })
  }

  // Unwind this session's mappings once the review behind them has ended.
  // Plannotator's own session list is the authority on that, not this session's
  // end: a review usually outlives the turn that opened it.
  for (const port of [...ours]) {
    if (live.has(port)) continue
    if ((await run($, ['tailscale', 'serve', `--https=${port}`, 'off'], 10000)).isOk) {
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
  // Drawn on the hint line under the prompt, beside the engine's own hint.
  //
  // 0.3.0 wrote the JSON and left a `statusLine` command to draw it, but a
  // plugin cannot ship that key (the manifest rejects `statusLine`) and
  // `$.settings` is read-only, so every install needed a hand-written command
  // plus this machine's own session-id path. A render hook is portable: it
  // installs with the plugin and needs nothing of the person's settings.
  //
  // `next(e)` is kept and drawn beside the link rather than replaced — that
  // tree is the engine's own hint line, and dropping it would trade one useful
  // line for another.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const drawn = await next(e)
    if (hint === null) return drawn

    const { Box, Link, Text } = $.ui.resolve(e)
    return (
      <Box>
        {drawn as never}
        <Text dimColor> review </Text>
        <Link href={hint.tailnet ?? hint.local} />
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

      const stopped: number[] = []
      for (const port of ours) {
        if ((await run($, ['tailscale', 'serve', `--https=${port}`, 'off'], 10000)).isOk) stopped.push(port)
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
