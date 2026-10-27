import type { On, ProcessRunResult } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

const HOST = 'demo.tailnet.ts.net'
const PORT = 41589
/**
 * The tailnet port the mod derives for `PORT`. Not `PORT`: `tailscale serve`
 * cannot take a port Plannotator itself binds on `0.0.0.0`, and it fails
 * silently when it tries — see `SERVE_OFFSET` in the hooks module.
 */
const SERVED = PORT + 1000
/** The Claude session under test, and the one whose reviews are none of its business. */
const SESSION_ID = 'session-1'
const OTHER_ID = 'session-2'

const SESSION = { cwd: '/tmp', surface: 'terminal', isInteractive: true } as const
const COMMAND = { command: 'plannotator-tailnet', args: '', origin: { kind: 'sdk' }, presentation: { isFullscreen: false, columns: 80 } } as const

const HOME = '/home/demo'
/** Where the status line command reads this session's reviews. */
const STATUS_FILE = `${HOME}/.claude/plannotator-tailnet/${SESSION_ID}.json`

const planReview = (port: number, sessionId: string) => ({
  index: 1,
  mode: 'plan',
  reviewId: 'pn-abc123',
  target: '/tmp/plan.md',
  url: `http://localhost:${port}`,
  port,
  pid: 42,
  project: 'demo',
  label: 'plan-demo',
  startedAt: '2026-10-11T05:05:03.433Z',
  hostSession: `claude-code:${sessionId}`,
})

type Host = {
  /** Every command the plugin ran, in order. */
  readonly lines: string[]
  /** What `tailscale serve` holds: HTTPS port to proxy target. */
  readonly served: Map<number, string>
  /** The environment the plugin read and wrote. */
  readonly env: Map<string, string>
  /** Every file the plugin wrote, by path: the last content. */
  readonly files: Map<string, string>
  /** A mapping standing before the plugin first looked. */
  preServe: (port: number, target: string) => void
  /** What `plannotator sessions --json` answers from here on. */
  setSessions: (sessions: readonly unknown[]) => void
  /**
   * Which tailnet ports really serve. Every port does by default; a port
   * removed here is one a `serve` reservation claims but whose tailscale0
   * listener never appeared — the failure this mod has to survive.
   */
  setUnreachable: (ports: readonly number[]) => void
  /** List tailnet listeners as WSL2's `ss` does: the address alone, no `%tailscale0`. */
  setBareListeners: (bare: boolean) => void
  /** Every `ss -ltn` the mod asked for. */
  readonly probed: () => number
}

/** Stands in for the host, so the test runs no tailscale, no plannotator, no ss. */
function fakeHost(on: On, sessions: readonly unknown[]): Host {
  const lines: string[] = []
  const served = new Map<number, string>()
  const env = new Map<string, string>()
  const files = new Map<string, string>()
  const unreachable = new Set<number>()
  let probes = 0
  let bareListeners = false
  let live: readonly unknown[] = sessions

  const reply = (stdout: string, exitCode = 0): { value: ProcessRunResult } => ({
    value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  })

  on('env.get', ($, e) => ({ value: env.get(e.name) }))
  on('env.set', ($, e) => {
    if (e.value === undefined) env.delete(e.name)
    else env.set(e.name, e.value)
    return { value: undefined }
  })

  on('fs.write', ($, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })

  on('process.run', ($, e) => {
    const argv = [...e.argv]
    const line = argv.join(' ')
    lines.push(line)

    if (line === 'sh -lc command -v plannotator') return reply('/opt/plannotator\n')
    if (line === 'sh -lc printf %s "$HOME"') return reply(HOME)
    if (argv[1] === 'sessions') return reply(JSON.stringify(live))

    // What the tailscaled side actually listens on: one `<ip>%tailscale0:<p>`
    // row per mapping that serves, and none for one whose reservation silently
    // failed — the whole point of probing this rather than `serve status`.
    //
    // The review's own `0.0.0.0:<port>` listener is always there, because
    // Plannotator binds that way. It must NOT read as the tailnet one: that
    // confusion is exactly the field failure this probe exists to catch.
    if (line === 'ss -ltn') {
      probes += 1
      const rows = [...live]
        .map(entry => (entry as { port?: number }).port)
        .filter((port): port is number => typeof port === 'number')
        .map(port => `LISTEN 0 512 0.0.0.0:${port} 0.0.0.0:*`)
      for (const port of served.keys()) {
        if (unreachable.has(port)) continue
        rows.push(`LISTEN 0 4096 100.64.0.1${bareListeners ? '' : '%tailscale0'}:${port} 0.0.0.0:*`)
      }
      return reply(rows.length > 0 ? `${rows.join('\n')}\n` : '')
    }

    if (line === 'tailscale status --json') {
      return reply(JSON.stringify({ Self: { DNSName: `${HOST}.` } }))
    }

    if (argv[0] === 'tailscale' && argv[1] === 'serve') {
      if (argv[2] === 'status') {
        return reply(
          JSON.stringify({
            TCP: Object.fromEntries([...served.keys()].map(port => [String(port), { HTTPS: true }])),
            Web: Object.fromEntries(
              [...served].map(([port, target]) => [`${HOST}:${port}`, { Handlers: { '/': { Proxy: target } } }]),
            ),
          }),
        )
      }

      const port = Number(argv.find(arg => arg.startsWith('--https='))?.slice('--https='.length))
      const last = argv[argv.length - 1]

      if (last === 'off') {
        if (!served.has(port)) return reply('handler does not exist', 1)
        served.delete(port)
        return reply('')
      }

      served.set(port, last ?? '')
      return reply('Serve started and running in the background.\n')
    }

    return reply('unknown command', 1)
  })

  return {
    lines,
    served,
    env,
    files,
    probed: () => probes,
    preServe: (port, target) => served.set(port, target),
    setSessions: next => {
      live = next
    },
    setUnreachable: ports => {
      unreachable.clear()
      for (const port of ports) unreachable.add(port)
    },
    setBareListeners: bare => {
      bareListeners = bare
    },
  }
}

function setUp(on: On, sessions: readonly unknown[], entries?: Readonly<Record<string, unknown>>): Host {
  mock.store(on, entries)
  mock.clock(on)

  // The engine's own answers for what the mod calls and nothing beneath it serves.
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: SESSION_ID }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  // The engine's own band, empty: the mod draws its rows under this and returns
  // it unchanged when no review is live.
  on('ui.render', { component: 'AbovePrompt' }, () => h(Fragment, null) as never)

  return fakeHost(on, sessions)
}

test('publishes a live review of this session, and names the tailnet URL', async ($, on) => {
  const host = setUp(on, [planReview(PORT, SESSION_ID)])

  await $.session.start({ ...SESSION })
  const answer = await $.command.run({ ...COMMAND })

  // The listener gets a port of its own; the review keeps its own.
  expect(host.lines).toContain(`tailscale serve --bg --https=${SERVED} http://127.0.0.1:${PORT}`)
  expect(host.served.get(SERVED)).toBe(`http://127.0.0.1:${PORT}`)
  expect(answer.text).toContain(`https://${HOST}:${SERVED}/`)
})

test("leaves another Claude session's review alone", async ($, on) => {
  const host = setUp(on, [planReview(PORT, OTHER_ID)])

  await $.session.start({ ...SESSION })
  const answer = await $.command.run({ ...COMMAND })

  expect(host.lines.filter(line => line.startsWith('tailscale serve --bg'))).toEqual([])
  expect(host.served.has(SERVED)).toBe(false)
  expect(answer.text).toBe('No live Plannotator sessions of this session’s.')
})

test('leaves a review nothing tagged alone', async ($, on) => {
  const untagged = { ...planReview(PORT, SESSION_ID) } as Record<string, unknown>
  delete untagged['hostSession']
  const host = setUp(on, [untagged])

  await $.session.start({ ...SESSION })
  await $.command.run({ ...COMMAND })

  expect(host.served.has(SERVED)).toBe(false)
})

test('leaves a port already serving something else alone', async ($, on) => {
  const host = setUp(on, [planReview(PORT, SESSION_ID)])
  host.preServe(SERVED, 'http://127.0.0.1:9000')

  await $.session.start({ ...SESSION })
  const answer = await $.command.run({ ...COMMAND })

  expect(host.served.get(SERVED)).toBe('http://127.0.0.1:9000')
  expect(host.lines.filter(line => line.startsWith('tailscale serve --bg'))).toEqual([])
  expect(answer.text).toContain(`already serves http://127.0.0.1:9000`)
})

test('unwinds the mapping it published, and only once its session is gone', async ($, on) => {
  const host = setUp(on, [planReview(PORT, SESSION_ID)])
  host.preServe(8788, 'http://127.0.0.1:8788')

  await $.session.start({ ...SESSION })
  await $.command.run({ ...COMMAND })
  expect(host.served.has(SERVED)).toBe(true)

  // The review is closed, but the mapping the person made is not this mod's to remove.
  host.setSessions([])
  await $.command.run({ ...COMMAND })

  expect(host.served.has(SERVED)).toBe(false)
  expect(host.served.get(8788)).toBe('http://127.0.0.1:8788')
  expect(host.lines).toContain(`tailscale serve --https=${SERVED} off`)
})

test('reaps a mapping a session that ended left standing', async ($, on) => {
  const host = setUp(on, [], { [`published:claude-code:gone`]: [PORT] })
  host.preServe(SERVED, `http://127.0.0.1:${PORT}`)

  await $.session.start({ ...SESSION })
  await $.command.run({ ...COMMAND })

  expect(host.served.has(SERVED)).toBe(false)
  expect(host.lines).toContain(`tailscale serve --https=${SERVED} off`)
})

test('re-files what the one-key version published, and reaps the review that is gone', async ($, on) => {
  const host = setUp(on, [planReview(PORT, SESSION_ID)], { 'plannotator-tailnet.published': [PORT, 9999] })
  host.preServe(SERVED, `http://127.0.0.1:${PORT}`)
  host.preServe(9999 + 1000, 'http://127.0.0.1:9999')

  await $.session.start({ ...SESSION })
  await $.command.run({ ...COMMAND })

  // The live review is this session's now, so this session tears it down.
  expect(host.served.has(SERVED)).toBe(true)
  expect(host.served.has(9999 + 1000)).toBe(false)

  host.setSessions([])
  await $.command.run({ ...COMMAND })
  expect(host.served.has(SERVED)).toBe(false)
})

test('publishes nothing when no review is live', async ($, on) => {
  const host = setUp(on, [])

  await $.session.start({ ...SESSION })
  const answer = await $.command.run({ ...COMMAND })

  expect(host.lines.filter(line => line.startsWith('tailscale serve --bg'))).toEqual([])
  expect(answer.text).toBe('No live Plannotator sessions of this session’s.')
})

test('off unpublishes what it published, leaving other mappings standing', async ($, on) => {
  const host = setUp(on, [planReview(PORT, SESSION_ID)])
  host.preServe(8788, 'http://127.0.0.1:8788')

  await $.session.start({ ...SESSION })
  await $.command.run({ ...COMMAND })
  await $.command.run({ ...COMMAND, args: 'off' })

  expect(host.served.has(SERVED)).toBe(false)
  expect(host.served.get(8788)).toBe('http://127.0.0.1:8788')
})

test('lists this machine among the hostnames Plannotator answers on', async ($, on) => {
  const host = setUp(on, [])

  await $.session.start({ ...SESSION })

  expect(host.env.get('PLANNOTATOR_ALLOWED_HOSTS')).toBe(HOST)
})

test('adds to an allowlist already set, and keeps one that lists this machine', async ($, on) => {
  const host = setUp(on, [])
  host.env.set('PLANNOTATOR_ALLOWED_HOSTS', 'other.example')

  await $.session.start({ ...SESSION })
  expect(host.env.get('PLANNOTATOR_ALLOWED_HOSTS')).toBe(`other.example,${HOST}`)
})

test("leaves an allowlist that turns the check off as it is", async ($, on) => {
  const host = setUp(on, [])
  host.env.set('PLANNOTATOR_ALLOWED_HOSTS', '*')

  await $.session.start({ ...SESSION })

  expect(host.env.get('PLANNOTATOR_ALLOWED_HOSTS')).toBe('*')
})

test('the command repairs the allowlist too, for a session that began without it', async ($, on) => {
  // A session whose `settings.json` had no entry: nothing ran at its start.
  const host = setUp(on, [])
  await $.command.run({ ...COMMAND })

  expect(host.env.get('PLANNOTATOR_ALLOWED_HOSTS')).toBe(HOST)
})

test('writes the review for the status line: localhost and tailnet link', async ($, on) => {
  const host = setUp(on, [planReview(PORT, SESSION_ID)])

  await $.session.start({ ...SESSION })
  await $.command.run({ ...COMMAND })

  expect(JSON.parse(host.files.get(STATUS_FILE) ?? 'null')).toEqual([
    { label: 'demo (plan)', local: `http://localhost:${PORT}`, tailnet: `https://${HOST}:${SERVED}/` },
  ])
})

test('writes the localhost link alone while the port is not published', async ($, on) => {
  const host = setUp(on, [planReview(PORT, SESSION_ID)])
  host.preServe(SERVED, 'http://127.0.0.1:9000')

  await $.session.start({ ...SESSION })
  await $.command.run({ ...COMMAND })

  expect(JSON.parse(host.files.get(STATUS_FILE) ?? 'null')).toEqual([{ label: 'demo (plan)', local: `http://localhost:${PORT}` }])
})

test("empties the status file once the review ends, and never lists another session's", async ($, on) => {
  const host = setUp(on, [planReview(PORT, SESSION_ID), planReview(PORT + 1, OTHER_ID)])

  await $.session.start({ ...SESSION })
  await $.command.run({ ...COMMAND })
  expect(JSON.parse(host.files.get(STATUS_FILE) ?? 'null')).toHaveLength(1)

  host.setSessions([planReview(PORT + 1, OTHER_ID)])
  await $.command.run({ ...COMMAND })
  expect(JSON.parse(host.files.get(STATUS_FILE) ?? 'null')).toEqual([])
})

test('off empties the status file', async ($, on) => {
  const host = setUp(on, [planReview(PORT, SESSION_ID)])

  await $.session.start({ ...SESSION })
  await $.command.run({ ...COMMAND })
  await $.command.run({ ...COMMAND, args: 'off' })

  expect(JSON.parse(host.files.get(STATUS_FILE) ?? 'null')).toEqual([])
})

/** The band as the mod draws it: every Link in the tree, in order. */
async function drawBand($: Engine): Promise<{ href?: string; label?: string }[]> {
  const drawn = await $.ui.render({
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 6 }, view: {} },
    requestId: 'band',
  } as never)

  const nodes: any[] = []
  const walk = (node: any): void => {
    if (node === null || typeof node !== 'object') return
    nodes.push(node)
    for (const child of node.children ?? []) walk(child)
  }
  walk(drawn)

  return nodes.filter(node => node.type === 'Link').map(node => ({ href: node.props?.href, label: node.props?.label }))
}

test('draws a live review in the band above the prompt, named and with its transport', async ($, on) => {
  setUp(on, [planReview(PORT, SESSION_ID)])

  await $.session.start({ ...SESSION })
  await $.command.run({ ...COMMAND })

  // The review's own label, then how it is reachable: `tailnet` and `local` alone
  // named the transport but not the review, so two live reviews were
  // indistinguishable.
  expect(await drawBand($)).toEqual([{ href: `https://${HOST}:${SERVED}/`, label: 'demo (plan) · tailnet' }])
})

test('labels the link "local" while only the loopback URL is known', async ($, on) => {
  const host = setUp(on, [planReview(PORT, SESSION_ID)])
  host.preServe(SERVED, 'http://127.0.0.1:9000')

  await $.session.start({ ...SESSION })
  await $.command.run({ ...COMMAND })

  expect(await drawBand($)).toEqual([{ href: `http://localhost:${PORT}`, label: 'demo (plan) · local' }])
})

test('draws every live review, not only the newest', async ($, on) => {
  // Two reviews of this session's, as a session that opened a plan and a diff
  // review has. The old line drew entries[0] and hid the other completely.
  setUp(on, [planReview(PORT, SESSION_ID), planReview(PORT + 1, SESSION_ID)])

  await $.session.start({ ...SESSION })
  await $.command.run({ ...COMMAND })

  const links = await drawBand($)
  expect(links).toHaveLength(2)
  expect(links.map(link => link.href)).toEqual([
    `https://${HOST}:${SERVED}/`,
    `https://${HOST}:${SERVED + 1}/`,
  ])
})

test('yields the band to a survey rather than stacking under it', async ($, on) => {
  setUp(on, [planReview(PORT, SESSION_ID)])

  await $.session.start({ ...SESSION })
  await $.command.run({ ...COMMAND })

  const drawn = await $.ui.render({
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: true, isWorking: false, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 6 }, view: {} },
    requestId: 'band',
  } as never)

  const nodes: any[] = []
  const walk = (node: any): void => {
    if (node === null || typeof node !== 'object') return
    nodes.push(node)
    for (const child of node.children ?? []) walk(child)
  }
  walk(drawn)

  expect(nodes.find(node => node.type === 'Link')).toBeUndefined()
})

test('draws nothing in the band before a review is live', async ($, on) => {
  setUp(on, [])

  await $.session.start({ ...SESSION })
  await $.command.run({ ...COMMAND })

  expect(await drawBand($)).toEqual([])
})

test('re-publishes a reservation that is standing but does not answer', async ($, on) => {
  // The failure this exists for: `tailscale serve` accepted a port another
  // process binds on 0.0.0.0, so status prints the mapping while every https
  // request to it dies. The mod must not treat the printed mapping as a link.
  const host = setUp(on, [planReview(PORT, SESSION_ID)])
  host.preServe(SERVED, `http://127.0.0.1:${PORT}`)
  host.setUnreachable([SERVED])

  await $.session.start({ ...SESSION })
  const answer = await $.command.run({ ...COMMAND })

  expect(host.probed()).toBeGreaterThan(0)
  expect(answer.text).toContain(`:${SERVED} was reserved but does not answer`)
  expect(answer.text).not.toContain(`serving  https://${HOST}:${SERVED}/`)
})

test('withholds the tailnet link until the listener appears', async ($, on) => {
  const host = setUp(on, [planReview(PORT, SESSION_ID)])
  host.setUnreachable([SERVED])

  await $.session.start({ ...SESSION })
  const answer = await $.command.run({ ...COMMAND })

  expect(answer.text).toContain(`:${SERVED} reserved but not answering yet`)
  // The localhost link still works, so it is what the person is given.
  expect(JSON.parse(host.files.get(STATUS_FILE) ?? 'null')).toEqual([
    { label: 'demo (plan)', local: `http://localhost:${PORT}` },
  ])
})

test('a port with no tailnet port of its own is skipped, not wrapped', async ($, on) => {
  // 65535 + the offset is not a port; publishing must not roll over onto one
  // the person may already be serving.
  const host = setUp(on, [planReview(65535, SESSION_ID)])

  await $.session.start({ ...SESSION })
  const answer = await $.command.run({ ...COMMAND })

  expect(host.lines.filter(line => line.startsWith('tailscale serve --bg'))).toEqual([])
  expect(answer.text).toContain('has no tailnet port of its own')
})

test('probes a tailnet port once, not on every sync', async ($, on) => {
  const host = setUp(on, [planReview(PORT, SESSION_ID)])

  await $.session.start({ ...SESSION })
  await $.command.run({ ...COMMAND })
  const afterFirst = host.probed()
  await $.command.run({ ...COMMAND })

  // The port is known to serve after the first sync, so the second reads
  // nothing more: `ss` on every 4-second tick would be pure churn.
  expect(afterFirst).toBeGreaterThan(0)
  expect(host.probed()).toBe(afterFirst)
})

test('a listener on 0.0.0.0 is not mistaken for the tailnet one', async ($, on) => {
  // The failure in the field: serve status printed the mapping, and the only
  // listener on the port was the review's own 0.0.0.0 bind, so every https
  // request died with `wrong version number`. The probe must key on the
  // tailscale0 interface, not on the port alone.
  const host = setUp(on, [planReview(PORT, SESSION_ID)])
  host.setUnreachable([SERVED])

  await $.session.start({ ...SESSION })
  const answer = await $.command.run({ ...COMMAND })

  expect(answer.text).toContain('reserved but not answering')
  expect(host.files.get(STATUS_FILE) ?? '').not.toContain('tailnet')
})

test('a tailnet listener listed without its interface still counts (WSL2)', async ($, on) => {
  // WSL2's `ss` prints the tailnet address alone, `100.x.y.z:<port>`, with no
  // `%tailscale0`. The link answers, so it must be shown; the address being a
  // tailnet one is what tells it apart from the review's own 0.0.0.0 bind.
  const host = setUp(on, [planReview(PORT, SESSION_ID)])
  host.setBareListeners(true)

  await $.session.start({ ...SESSION })
  await $.command.run({ ...COMMAND })

  expect(JSON.parse(host.files.get(STATUS_FILE) ?? 'null')).toEqual([
    { label: 'demo (plan)', local: `http://localhost:${PORT}`, tailnet: `https://${HOST}:${SERVED}/` },
  ])
})

test('a review whose own port is the derived one does not fake its own listener', async ($, on) => {
  // Two reviews are enough to make this real: the first derives SERVED, and
  // the second binds SERVED itself on 0.0.0.0. An unanchored port search then
  // finds the second review's own listener and calls the first published,
  // republishing the exact `wrong version number` link this probe exists to
  // withhold. Only `%tailscale0:SERVED` is the tailnet's.
  const host = setUp(on, [planReview(PORT, SESSION_ID), planReview(SERVED, SESSION_ID)])
  host.setUnreachable([SERVED])

  await $.session.start({ ...SESSION })
  await $.command.run({ ...COMMAND })

  const written = JSON.parse(host.files.get(STATUS_FILE) ?? '[]')
  const first = written.find((entry: { local: string }) => entry.local === `http://localhost:${PORT}`)
  expect(first?.tailnet).toBeUndefined()
})
