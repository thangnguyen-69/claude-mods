import type { On, ProcessRunResult, RenderPropsOf } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const HOST = 'demo.tailnet.ts.net'
const PORT = 41589
/** The Claude session under test, and the one whose reviews are none of its business. */
const SESSION_ID = 'session-1'
const OTHER_ID = 'session-2'

const SESSION = { cwd: '/tmp', surface: 'terminal', isInteractive: true } as const
const COMMAND = { command: 'plannotator-tailnet', args: '', origin: { kind: 'sdk' }, presentation: { isFullscreen: false, columns: 80 } } as const

/** The band's props: the mod reads `hasSurvey`, the rest belong to the engine. */
const BAND = { hasSurvey: false } as unknown as RenderPropsOf['AbovePrompt']

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
  /** A mapping standing before the plugin first looked. */
  preServe: (port: number, target: string) => void
  /** What `plannotator sessions --json` answers from here on. */
  setSessions: (sessions: readonly unknown[]) => void
}

/** Stands in for the host, so the test runs no tailscale and no plannotator. */
function fakeHost(on: On, sessions: readonly unknown[]): Host {
  const lines: string[] = []
  const served = new Map<number, string>()
  const env = new Map<string, string>()
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

  on('process.run', ($, e) => {
    const argv = [...e.argv]
    const line = argv.join(' ')
    lines.push(line)

    if (line === 'sh -lc command -v plannotator') return reply('/opt/plannotator\n')
    if (argv[1] === 'sessions') return reply(JSON.stringify(live))

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
    preServe: (port, target) => served.set(port, target),
    setSessions: next => {
      live = next
    },
  }
}

function setUp(on: On, sessions: readonly unknown[], entries?: Readonly<Record<string, unknown>>): Host {
  mock.store(on, entries)
  mock.clock(on)

  // The engine's own answers for what the mod calls and nothing beneath it serves.
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: SESSION_ID }))
  // The engine's own band, which is empty: a mount needs something beneath it.
  on('ui.render', { component: 'AbovePrompt' }, () => h(Fragment, null))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))

  return fakeHost(on, sessions)
}

test('publishes a live review of this session, and names the tailnet URL', async ($, on) => {
  const host = setUp(on, [planReview(PORT, SESSION_ID)])

  await $.session.start({ ...SESSION })
  const answer = await $.command.run({ ...COMMAND })

  expect(host.lines).toContain(`tailscale serve --bg --https=${PORT} http://127.0.0.1:${PORT}`)
  expect(host.served.get(PORT)).toBe(`http://127.0.0.1:${PORT}`)
  expect(answer.text).toContain(`https://${HOST}:${PORT}/`)
})

test("leaves another Claude session's review alone", async ($, on) => {
  const host = setUp(on, [planReview(PORT, OTHER_ID)])

  await $.session.start({ ...SESSION })
  const answer = await $.command.run({ ...COMMAND })

  expect(host.lines.filter(line => line.startsWith('tailscale serve --bg'))).toEqual([])
  expect(host.served.has(PORT)).toBe(false)
  expect(answer.text).toBe('No live Plannotator sessions of this session’s.')
})

test('leaves a review nothing tagged alone', async ($, on) => {
  const untagged = { ...planReview(PORT, SESSION_ID) } as Record<string, unknown>
  delete untagged['hostSession']
  const host = setUp(on, [untagged])

  await $.session.start({ ...SESSION })
  await $.command.run({ ...COMMAND })

  expect(host.served.has(PORT)).toBe(false)
})

test('leaves a port already serving something else alone', async ($, on) => {
  const host = setUp(on, [planReview(PORT, SESSION_ID)])
  host.preServe(PORT, 'http://127.0.0.1:9000')

  await $.session.start({ ...SESSION })
  const answer = await $.command.run({ ...COMMAND })

  expect(host.served.get(PORT)).toBe('http://127.0.0.1:9000')
  expect(host.lines.filter(line => line.startsWith('tailscale serve --bg'))).toEqual([])
  expect(answer.text).toContain(`already serves http://127.0.0.1:9000`)
})

test('unwinds the mapping it published, and only once its session is gone', async ($, on) => {
  const host = setUp(on, [planReview(PORT, SESSION_ID)])
  host.preServe(8788, 'http://127.0.0.1:8788')

  await $.session.start({ ...SESSION })
  await $.command.run({ ...COMMAND })
  expect(host.served.has(PORT)).toBe(true)

  // The review is closed, but the mapping the person made is not this mod's to remove.
  host.setSessions([])
  await $.command.run({ ...COMMAND })

  expect(host.served.has(PORT)).toBe(false)
  expect(host.served.get(8788)).toBe('http://127.0.0.1:8788')
  expect(host.lines).toContain(`tailscale serve --https=${PORT} off`)
})

test('reaps a mapping a session that ended left standing', async ($, on) => {
  const host = setUp(on, [], { [`published:claude-code:gone`]: [PORT] })
  host.preServe(PORT, `http://127.0.0.1:${PORT}`)

  await $.session.start({ ...SESSION })
  await $.command.run({ ...COMMAND })

  expect(host.served.has(PORT)).toBe(false)
  expect(host.lines).toContain(`tailscale serve --https=${PORT} off`)
})

test('re-files what the one-key version published, and reaps the review that is gone', async ($, on) => {
  const host = setUp(on, [planReview(PORT, SESSION_ID)], { 'plannotator-tailnet.published': [PORT, 9999] })
  host.preServe(PORT, `http://127.0.0.1:${PORT}`)
  host.preServe(9999, 'http://127.0.0.1:9999')

  await $.session.start({ ...SESSION })
  await $.command.run({ ...COMMAND })

  // The live review is this session's now, so this session tears it down.
  expect(host.served.has(PORT)).toBe(true)
  expect(host.served.has(9999)).toBe(false)

  host.setSessions([])
  await $.command.run({ ...COMMAND })
  expect(host.served.has(PORT)).toBe(false)
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

  expect(host.served.has(PORT)).toBe(false)
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

test('draws the review as a hyperlink above the prompt', async ($, on) => {
  const host = setUp(on, [planReview(PORT, SESSION_ID)])
  const ui = await $.ui.mount({ plugin: 'plannotator-tailnet', surface: 'terminal', component: 'AbovePrompt', props: BAND })

  // Nothing to link to before a review is live.
  expect(await ui.findAll({ type: 'Link' })).toHaveLength(0)

  await $.session.start({ ...SESSION })
  await $.command.run({ ...COMMAND })

  const links = await ui.findAll({ type: 'Link' })
  expect(links).toHaveLength(1)
  expect(links[0]?.props['href']).toBe(`https://${HOST}:${PORT}/`)
  expect(host.served.has(PORT)).toBe(true)
})

test('yields the band to a survey', async ($, on) => {
  setUp(on, [planReview(PORT, SESSION_ID)])
  const ui = await $.ui.mount({
    plugin: 'plannotator-tailnet',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: true } as unknown as RenderPropsOf['AbovePrompt'],
  })

  await $.session.start({ ...SESSION })
  await $.command.run({ ...COMMAND })

  expect(await ui.findAll({ type: 'Link' })).toHaveLength(0)
})
