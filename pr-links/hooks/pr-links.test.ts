import type { On, RenderPropsOf } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import {
  EMPTY,
  MAX_KEPT,
  extractPrLinks,
  mergeLinks,
  parsePrUrl,
  statusLink,
} from './format'

const FORGEJO_PR = 'https://git.lumora.bio/A80Lab/lumora-landingpage/pulls/27'
const GITHUB_PR = 'https://github.com/acme/widgets/pull/412'
const GITLAB_MR = 'https://gitlab.com/acme/widgets/-/merge_requests/88'

/** The hint line's props: the mod reads none of them, they belong to the engine. */
const HINT = { isDraft: false, isWorking: false, hint: '' } as unknown as RenderPropsOf['PromptHint']

/** This test session, whose links are restored from `$.store` by its id. */
const SESSION_ID = 'session-1'

test('reads a pull request from every forge shape, by path alone', () => {
  expect(parsePrUrl(FORGEJO_PR)).toEqual({
    url: FORGEJO_PR,
    host: 'git.lumora.bio',
    repo: 'A80Lab/lumora-landingpage',
    number: '27',
    kind: 'pull',
  })
  expect(parsePrUrl(GITHUB_PR)?.number).toBe('412')
  expect(parsePrUrl(GITLAB_MR)).toEqual({
    url: GITLAB_MR,
    host: 'gitlab.com',
    repo: 'acme/widgets',
    number: '88',
    kind: 'merge_request',
  })

  // Bitbucket and Azure DevOps, so a custom host needs no code to be supported.
  expect(parsePrUrl('https://bitbucket.org/acme/widgets/pull-requests/7')?.number).toBe('7')
  expect(parsePrUrl('https://dev.azure.com/acme/Widgets/_git/widgets/pullrequest/99')).toEqual({
    url: 'https://dev.azure.com/acme/Widgets/_git/widgets/pullrequest/99',
    host: 'dev.azure.com',
    repo: 'acme/Widgets/widgets',
    number: '99',
    kind: 'pull',
  })
})

test('a URL that names something else is not a pull request', () => {
  expect(parsePrUrl('https://git.lumora.bio/A80Lab/lumora-landingpage')).toBeNull()
  expect(parsePrUrl('https://git.lumora.bio/A80Lab/lumora-landingpage/issues/27')).toBeNull()
  expect(parsePrUrl('https://example.com/a/b/pull/not-a-number')).toBeNull()
  expect(parsePrUrl('not a url at all')).toBeNull()
  // A scheme that is not a web page is never a pull request.
  expect(parsePrUrl('file:///a/b/pull/1')).toBeNull()
})

test('finds a URL inside a line of prose, trimming the punctuation around it', () => {
  const found = extractPrLinks(`Created: see ${FORGEJO_PR}.`)
  expect(found.map(link => link.number)).toEqual(['27'])

  // A parenthetical must not eat the URL's own closing bracket, nor keep the
  // prose's.
  const parenthetical = extractPrLinks(`(opened at ${GITHUB_PR}).`)
  expect(parenthetical[0]?.url).toBe(GITHUB_PR)

  const bracketed = extractPrLinks('see https://en.wikipedia.org/wiki/Foo_(bar) now')
  expect(bracketed).toEqual([])
  expect(parsePrUrl('https://en.wikipedia.org/wiki/Foo_(bar)')).toBeNull()
})

test('reads a URL out of an OSC 8 hyperlink, which is how tea prints it', () => {
  // `tea pr create` wraps the URL in its own opener payload and repeats it as
  // the visible text; the payload and the text are separate tokens here.
  const wrapped = `\u001b]8;;${FORGEJO_PR}\u001b\\${FORGEJO_PR}\u001b]8;;\u001b\\`
  expect(extractPrLinks(wrapped).map(link => link.url)).toEqual([FORGEJO_PR])
})

test('lists a URL printed twice once, in the order printed', () => {
  const found = extractPrLinks(`${GITHUB_PR}\n${FORGEJO_PR}\n${GITHUB_PR}`)
  expect(found.map(link => link.number)).toEqual(['412', '27'])
})

test('keeps the newest links and lets the oldest fall off', () => {
  const links = Array.from({ length: MAX_KEPT + 2 }, (_, i) => ({
    url: `https://github.com/acme/widgets/pull/${i}`,
    host: 'github.com',
    repo: 'acme/widgets',
    number: String(i),
    kind: 'pull' as const,
  }))

  // Printed order is oldest-first, so the last two a command said are the
  // newest: those lead, and the earliest fall off the end.
  expect(mergeLinks([], links).map(link => link.number)).toEqual(['6', '5', '4', '3', '2'])
  // A later find goes in front of what was already known.
  expect(mergeLinks(links.slice(0, 2), links.slice(2, 3)).map(link => link.number)).toEqual(['2', '0', '1'])
  // A repeat keeps one entry.
  expect(mergeLinks(links.slice(0, 1), links.slice(0, 1))).toHaveLength(1)
})

test('label and URL stay separate fields, never one string', () => {
  expect(statusLink(EMPTY)).toBeUndefined()
  expect(statusLink({ ...EMPTY, isHidden: true, links: extractPrLinks(FORGEJO_PR) })).toBeUndefined()

  expect(statusLink({ ...EMPTY, links: extractPrLinks(FORGEJO_PR) })).toEqual({
    label: 'PR #27',
    url: FORGEJO_PR,
    older: 0,
  })
  expect(statusLink({ ...EMPTY, links: extractPrLinks(`${GITHUB_PR} ${FORGEJO_PR}`) })).toEqual({
    label: 'PR #412',
    url: GITHUB_PR,
    older: 1,
  })

  // A merge request is called what its host calls it.
  expect(statusLink({ ...EMPTY, links: extractPrLinks(GITLAB_MR) })?.label).toBe('MR #88')
})

/** The engine's own answers for what the mod calls and nothing beneath it serves. */
function setUp(
  on: On,
  stored: Readonly<Record<string, unknown>> = {},
): { lines: (string | undefined)[]; redraws: string[] } {
  const lines: (string | undefined)[] = []
  const redraws: string[] = []

  mock.store(on, stored)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: SESSION_ID }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.status', ($, e) => {
    lines.push(e.text)
    return { value: undefined }
  })
  // A drawn hint line stays cached until something asks for a fresh one, so the
  // mod has to invalidate; this records those asks.
  on('ui.invalidate', ($, e) => {
    redraws.push(e.event)
    return { value: undefined }
  })
  // The engine's own hint line, empty: the mod draws this beside its link and
  // returns it unchanged when it has nothing to add.
  on('ui.render', { component: 'PromptHint' }, () => h(Fragment, null) as never)

  return { lines, redraws }
}

/** Answers a Bash call as the engine does, with the output a command printed. */
function answerBash(on: On, output: string, init?: { isError?: true }): void {
  on('tool.call', { tool: 'Bash' }, () =>
    init?.isError === true
      ? { isError: true as const, result: undefined, text: output }
      : { result: { stdout: output, stderr: '' }, text: output },
  )
}

/**
 * The band as the mod draws it, read through the engine's own render call.
 */
async function drawBand($: Engine): Promise<{ href?: string; label?: string }> {
  const drawn = await $.ui.render({
    surface: 'terminal',
    component: 'PromptHint',
    props: HINT,
    requestId: 'band',
  } as never)
  const nodes: any[] = []
  const walk = (node: any): void => {
    if (node === null || typeof node !== 'object') return
    nodes.push(node)
    for (const child of node.children ?? []) walk(child)
  }
  walk(drawn)

  const link = nodes.find(node => node.type === 'Link')
  return { href: link?.props?.href, label: link?.props?.label }
}

test('a Bash call that prints a PR URL puts it on the hint line as a link', async ($, on) => {
  setUp(on)
  answerBash(on, `Created pull request\n${FORGEJO_PR}\n`)

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)
  await $.tool.call({ tool: 'Bash', command: 'tea pr create --repo A80Lab/lumora-landingpage' })

  const band = await drawBand($)
  expect(band.href).toBe(FORGEJO_PR)
  expect(band.label).toBe('PR #27')
})

test('nothing with ESC bytes ever reaches the status line', async ($, on) => {
  const { lines } = setUp(on)
  answerBash(on, `${FORGEJO_PR}\n`)

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)
  await $.tool.call({ tool: 'Bash', command: 'echo the link' })

  // Every pinned line must be undefined or free of control characters: an OSC 8
  // sequence in the status text is what made the engine echo it back as
  // `⚠ pr-links: …` on every repaint.
  expect(lines.every(line => line === undefined || !line.includes('\u001b'))).toBe(true)
})

test('a Bash call with no PR URL draws nothing', async ($, on) => {
  setUp(on)
  answerBash(on, 'compiled 3 files\n')

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)
  await $.tool.call({ tool: 'Bash', command: 'npm test' })

  expect((await drawBand($)).href).toBeUndefined()
})

test('an errored Bash call contributes nothing even if its text names a URL', async ($, on) => {
  setUp(on)
  answerBash(on, `fatal: ${FORGEJO_PR} could not be created`, { isError: true })

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)
  await $.tool.call({ tool: 'Bash', command: 'tea pr create' })

  expect((await drawBand($)).href).toBeUndefined()
})

test('/pr toggles the link and stays quiet about an empty session', async ($, on) => {
  setUp(on)
  answerBash(on, `${FORGEJO_PR}\n`)

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)

  const empty = await $.command.run({ command: 'pr', args: '', origin: { kind: 'sdk' }, presentation: { isFullscreen: false, columns: 80 } } as never)
  expect(empty.text).toContain('No pull request URL')

  await $.tool.call({ tool: 'Bash', command: 'tea pr create' })
  expect((await drawBand($)).href).toBe(FORGEJO_PR)

  const hidden = await $.command.run({ command: 'pr', args: '', origin: { kind: 'sdk' }, presentation: { isFullscreen: false, columns: 80 } } as never)
  expect(hidden.text).toContain('hidden')
  expect((await drawBand($)).href).toBeUndefined()

  const shown = await $.command.run({ command: 'pr', args: '', origin: { kind: 'sdk' }, presentation: { isFullscreen: false, columns: 80 } } as never)
  expect(shown.text).toContain('shown above the prompt')
  expect((await drawBand($)).href).toBe(FORGEJO_PR)
})

test('a resumed session asks for a fresh hint line, or the remembered link stays invisible', async ($, on) => {
  const { redraws } = setUp(on)
  answerBash(on, `${FORGEJO_PR}\n`)

  // The first process records the link, then the thread is resumed: the new
  // process starts with the hint line already drawn from the old answer, and a
  // repaint reuses it. Without an invalidate the link is in state but nowhere
  // on screen.
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)
  await $.tool.call({ tool: 'Bash', command: 'echo the link' })
  expect(redraws).toContain('ui.render')

  const redrawsBefore = redraws.length
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)
  expect(redraws.length).toBeGreaterThan(redrawsBefore)
})

test('recording a new link and toggling both ask for a redraw', async ($, on) => {
  const { redraws } = setUp(on)
  answerBash(on, `${FORGEJO_PR}\n`)
  const command = { command: 'pr', args: '', origin: { kind: 'sdk' }, presentation: { isFullscreen: false, columns: 80 } } as never

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)
  const afterStart = redraws.length
  await $.tool.call({ tool: 'Bash', command: 'echo the link' })
  expect(redraws.length).toBeGreaterThan(afterStart)

  const afterCall = redraws.length
  await $.command.run(command)
  expect(redraws.length).toBeGreaterThan(afterCall)
})

/**
 * The link a previous process recorded, as it sits in `$.store` for this
 * session. `$.state` does not cross processes, so this is the only way a
 * resumed session can know about it — the fix is that the mod reads it back.
 */
const STORED = {
  links: [{ url: FORGEJO_PR, host: 'git.lumora.bio', repo: 'A80Lab/lumora-landingpage', number: '27', kind: 'pull' }],
  isHidden: false,
}

test('a resumed session restores the link a previous process stored', async ($, on) => {
  // The store already holds it: exactly the state a fresh process starts in.
  setUp(on, { [`links:${SESSION_ID}`]: STORED })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)

  // No Bash call and no `/pr` in this process — the link can only be here
  // because `session.start` read it back out of the store.
  const band = await drawBand($)
  expect(band.href).toBe(FORGEJO_PR)
  expect(band.label).toBe('PR #27')
})

test('a stored link hidden by /pr resumes hidden', async ($, on) => {
  setUp(on, { [`links:${SESSION_ID}`]: { ...STORED, isHidden: true } })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)

  expect((await drawBand($)).href).toBeUndefined()
})

test('another session id does not inherit the links', async ($, on) => {
  setUp(on, { 'links:someone-else': STORED })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)

  expect((await drawBand($)).href).toBeUndefined()
})

test('a stored value from an older shape is ignored, not trusted', async ($, on) => {
  setUp(on, { [`links:${SESSION_ID}`]: { links: [{ nope: true }], isHidden: false } })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)

  expect((await drawBand($)).href).toBeUndefined()
})
