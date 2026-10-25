import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PrLinks } from '../types'
import { EMPTY, extractPrLinks, mergeLinks, statusLinks } from './format'

const prLinks = atom({ plugin: 'pr-links', key: 'prLinks' } as const, EMPTY)

/**
 * The text a Bash call printed: its stdout, and its stderr, because a forge CLI
 * writes the URL to whichever it likes (`tea pr create` uses stderr for the
 * summary on some versions).
 *
 * `result` is the tool's record and `text` the same as the model read it; either
 * may be missing, so both are tried rather than assuming a shape.
 */
function bashOutput(ran: unknown): string | undefined {
  if (typeof ran !== 'object' || ran === null) return undefined
  const { result, text } = ran as { result?: unknown; text?: unknown }

  if (typeof text === 'string' && text !== '') return text
  if (typeof result === 'string') return result
  if (typeof result === 'object' && result !== null) {
    const { stdout, stderr } = result as { stdout?: unknown; stderr?: unknown }
    const parts = [stdout, stderr].filter((part): part is string => typeof part === 'string' && part !== '')
    if (parts.length > 0) return parts.join('\n')
  }

  return undefined
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'pr',
      description: 'Show the pull request this session printed, or hide it from above the prompt',
    })

    // The links outlive a resume, which `$.state` alone does not: it survives a
    // hot reload of this code, not a new process. Restore them from `$.store`,
    // keyed by session id so a different thread does not inherit them.
    await restore($)

    // A resumed session also arrives with the hint line already drawn from the
    // previous process's answer, and a repaint reuses a cached answer.
    $.ui.invalidate('ui.render')

    return next(e)
  })

  // Drawn on the hint line under the prompt, where sire wants it.
  //
  // Not `$.ui.status`: that takes plain text, and an OSC 8 sequence in it is
  // echoed back as `⚠ <plugin>: …` with the raw escape bytes on every repaint.
  // A `Link` is the documented hyperlink and needs a render tree to live in.
  //
  // `next(e)` is kept and drawn beside the link rather than replaced — it is
  // the engine's own hint line (its key hints and pills), and dropping it would
  // trade one useful line for another.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const drawn = await next(e)

    const links = statusLinks(await read($, prLinks))
    if (links.length === 0) return drawn

    // Separated by a dim bullet rather than a bare space: with several links the
    // space alone leaves `infra #167 infra #168` reading as one run.
    const { Box, Link, Text } = $.ui.resolve(e)
    return (
      <Box>
        {drawn as never}
        <Text> </Text>
        {/* Flat, not a fragment per link: the render tree is built from the
            engine's own elements, and a bare `<>` is not one of them. An entry
            with no URL is the `+N more` count, which is text rather than a link. */}
        {links.flatMap((link, index) => [
          ...(index > 0 ? [<Text key={`sep-${index}`} dimColor> · </Text>] : []),
          link.url === undefined
            ? <Text key={`more-${index}`} dimColor>{link.label}</Text>
            : <Link key={link.url} href={link.url} label={link.label} />,
        ])}
      </Box>
    )
  })

  // The only place a PR URL enters the session: a command whose output names
  // one. `next` first, because the output is what the tool answered with, and
  // the answer is the whole reason to look.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)

    // A deny withheld the result, and an errored call never printed one.
    if (ran.deny !== undefined || ran.isError === true) return ran

    const output = bashOutput(ran)
    if (output === undefined) return ran

    const found = extractPrLinks(output)
    if (found.length === 0) return ran

    await update($, prLinks, current => {
      const merged = mergeLinks(current.links, found)
      // Keep the largest count seen: a later command must not make an earlier
      // overflow look like it never happened.
      return { ...current, links: merged.links, dropped: Math.max(current.dropped ?? 0, merged.dropped) }
    })
    await save($)
    $.ui.invalidate('ui.render')

    return ran
  }).catch(($, e, next) => {
    // This mod only reads the output: whatever it made of it, the call's own
    // result stands, and a failed read must never fail the command. `next(e)`
    // replays what the hook's own call settled to; `undefined` is the hook
    // absent, which leaves the engine's answer untouched.
    return next.called ? next(e) : undefined
  })

  on('command.run', { command: 'pr' }, async ($, e, next) => {
    const current = await read($, prLinks)

    // Nothing recorded yet: say so and change nothing. Toggling here would hide
    // the link before the first PR existed, and the session's first PR would
    // then never appear — the toggle has to be about something visible.
    if (current.links.length === 0) {
      return { text: 'No pull request URL has been printed in this session yet.' }
    }

    await update($, prLinks, cur => ({ ...cur, isHidden: !cur.isHidden }))
    await save($)
    $.ui.invalidate('ui.render')

    return {
      text: current.isHidden
        ? 'Pull request link shown above the prompt.'
        : 'Pull request link hidden. /pr shows it again.',
    }
  }).catch(($, e, next) =>
    // The command is this mod's own: failing to toggle must say so rather than
    // let `/pr` read as a command nobody answered.
    next.called ? next(e) : { text: 'The pull request link could not be toggled.' },
  )
}

/**
 * Where this session's links live between processes.
 *
 * `$.store` is the plugin's own cross-session store, so the key carries the
 * session id: a different thread must not inherit another's links.
 */
async function storeKey($: EngineInterface): Promise<string> {
  return `links:${await $.session.id()}`
}

/** Writes the current links where a resumed process will find them. */
async function save($: EngineInterface): Promise<void> {
  try {
    await $.store.set(await storeKey($), await read($, prLinks))
  } catch {
    // A store failure costs the links on resume, never the live session.
  }
}

/**
 * Reads back what this session recorded in an earlier process.
 *
 * `$.state` is per-process: the docs are explicit that it survives a hot reload
 * of the plugin's code, not a resume in a new one — "Persist through `$.store`".
 * Without this, `/pr` truthfully reports nothing printed after every resume.
 */
async function restore($: EngineInterface): Promise<void> {
  try {
    const stored = await $.store.get(await storeKey($))
    if (!isPrLinks(stored)) return

    await update($, prLinks, current => ({
      links: mergeLinks(current.links, stored.links).links,
      isHidden: stored.isHidden,
      dropped: Math.max(current.dropped ?? 0, stored.dropped ?? 0),
    }))
  } catch {
    // Nothing stored, or nothing readable: start empty.
  }
}

/**
 * Whether a stored value is one of ours.
 *
 * `$.store` hands back whatever was put there, including data an older version
 * wrote, so every field the rest of the code reads is checked.
 */
function isPrLinks(value: unknown): value is PrLinks {
  if (typeof value !== 'object' || value === null) return false
  const { links, isHidden, dropped } = value as { links?: unknown; isHidden?: unknown; dropped?: unknown }
  if (!Array.isArray(links) || typeof isHidden !== 'boolean') return false

  if (dropped !== undefined && typeof dropped !== 'number') return false

  return links.every((link) => {
    if (typeof link !== 'object' || link === null) return false
    const { url, host, number, kind } = link as Record<string, unknown>

    return (
      typeof url === 'string' &&
      typeof host === 'string' &&
      (number === undefined || typeof number === 'string') &&
      (kind === 'pull' || kind === 'merge_request' || kind === 'pull_request')
    )
  })
}
