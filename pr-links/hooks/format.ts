import type { PrLinks, PullRequest } from '../types'

/** Newest first, and only this many: the band has room for one. */
export const MAX_KEPT = 5

/** What the line and `/pr` draw before any command has printed a URL. */
export const EMPTY: PrLinks = { links: [], isHidden: false }

/**
 * Hosts are not enumerated on purpose. Every forge spells a pull request in one
 * of the path shapes below, so a self-hosted Gitea, GitLab or Azure DevOps
 * server is recognised by its URL alone — which is the whole point of a custom
 * git host. The shape is the contract, the hostname is not.
 */
const SHAPES: readonly {
  re: RegExp
  kind: PullRequest['kind']
  /** Path segments before the number: owner/repo for most, org/project/repo for Azure. */
  repoGroup: number
}[] = [
  // GitHub, Gitea, Forgejo, and most small forges: /owner/repo/pull/123
  { re: /^\/([^/]+)\/([^/]+)\/pulls?\/(\d+)/, kind: 'pull', repoGroup: 2 },
  // GitLab: /owner/repo/-/merge_requests/123, and older URLs without the /-
  { re: /^\/([^/]+)\/([^/]+)\/(?:-\/)?merge_requests\/(\d+)/, kind: 'merge_request', repoGroup: 2 },
  // Bitbucket: /owner/repo/pull-requests/123
  { re: /^\/([^/]+)\/([^/]+)\/pull-requests\/(\d+)/, kind: 'pull_request', repoGroup: 2 },
  // Azure DevOps: /org/project/_git/repo/pullrequest/123
  { re: /^\/([^/]+)\/([^/]+)\/_git\/([^/]+)\/pullrequest\/(\d+)/, kind: 'pull', repoGroup: 3 },
]

/**
 * Strips the terminal's own framing so a URL a command printed inside a
 * hyperlink still reads as one span.
 *
 * An OSC 8 opener carries the URL as its payload and the visible text follows
 * it, so the payload is replaced by a space rather than deleted: glued to the
 * text it would form one unparseable token. `tea pr create` prints exactly
 * this shape, which is how it was found.
 */
function unescapeTerminal(text: string): string {
  return text
    .replace(/\u001b]8;;[^\u001b\u0007]*(?:\u001b\\|\u0007)/g, ' ')
    .replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, '')
}

/** Trailing punctuation a URL picks up in prose, and a `)` that closes a parenthetical. */
function trimToken(token: string): string {
  let url = token.replace(/[.,;:!?'"]+$/, '')
  // Only drop a `)` the URL itself did not open, so a URL with a parenthesised
  // segment keeps it.
  while (url.endsWith(')') && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) {
    url = url.slice(0, -1).replace(/[.,;:!?'"]+$/, '')
  }
  return url
}

/** The pull request a URL names, or null when it names something else. */
export function parsePrUrl(raw: string): PullRequest | null {
  let url: URL
  try {
    url = new URL(trimToken(raw))
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null

  for (const shape of SHAPES) {
    const m = url.pathname.match(shape.re)
    if (!m) continue

    const segments = m.slice(1, shape.repoGroup + 1)
    const repo = segments.join('/')

    return { url: url.toString(), host: url.host, repo, number: m[shape.repoGroup + 1], kind: shape.kind }
  }

  return null
}

/** Every pull request URL in a command's output, in the order printed, deduped. */
export function extractPrLinks(output: string): PullRequest[] {
  const found: PullRequest[] = []
  const seen = new Set<string>()

  for (const token of unescapeTerminal(output).split(/\s+/)) {
    if (!token.includes('://')) continue

    const link = parsePrUrl(token)
    if (link === null || seen.has(link.url)) continue

    seen.add(link.url)
    found.push(link)
  }

  return found
}

/**
 * The newest `MAX_KEPT` of two lists, old ones falling off the end.
 *
 * `found` arrives in printed order, so its last entry is the newest thing this
 * command said — that is what goes in front. `existing` is already newest-first.
 */
export function mergeLinks(existing: readonly PullRequest[], found: readonly PullRequest[]): PullRequest[] {
  const byUrl = new Map<string, PullRequest>()
  for (const link of [...[...found].reverse(), ...existing]) {
    if (!byUrl.has(link.url)) byUrl.set(link.url, link)
  }

  return [...byUrl.values()].slice(0, MAX_KEPT)
}

/** What the host calls its pull requests, for the label. */
function kindLabel(kind: PullRequest['kind']): string {
  return kind === 'merge_request' ? 'MR' : 'PR'
}

/**
 * What the band draws: label and URL as **separate fields**, or undefined for
 * nothing.
 *
 * The URL must never be concatenated into a string handed to `$.ui.status`.
 * That call takes plain text, and raw ESC bytes in it make the engine emit a
 * `⚠ <plugin>: …` line showing the escapes on every repaint. Terminals do
 * support OSC 8; the status field is what refuses it cleanly. A `Link` element
 * is the documented hyperlink and the engine escapes it itself.
 */
export function statusLink(state: PrLinks): { label: string; url: string; older: number } | undefined {
  if (state.isHidden) return undefined

  const newest = state.links[0]
  if (newest === undefined) return undefined

  return {
    label: newest.number === undefined ? kindLabel(newest.kind) : `${kindLabel(newest.kind)} #${newest.number}`,
    url: newest.url,
    older: state.links.length - 1,
  }
}

