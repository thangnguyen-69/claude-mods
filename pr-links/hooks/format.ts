import type { PrLinks, PullRequest } from '../types'

/**
 * Newest first, and only this many.
 *
 * Raised from one: the band used to have room for a single link plus a count,
 * which meant the count hid *which* pull requests the older ones were — the only
 * reason to remember them. Eight is enough for a normal multi-PR session and
 * still bounded; anything beyond it is announced rather than dropped silently
 * (see `statusLinks`).
 */
export const MAX_KEPT = 8

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
 *
 * `dropped` counts what fell off the end so the band can say so. Silently
 * losing a link is worse than showing a count: it looks like the session only
 * ever opened `MAX_KEPT` of them.
 */
export function mergeLinks(
  existing: readonly PullRequest[],
  found: readonly PullRequest[],
): { links: PullRequest[]; dropped: number } {
  const byUrl = new Map<string, PullRequest>()
  for (const link of [...[...found].reverse(), ...existing]) {
    if (!byUrl.has(link.url)) byUrl.set(link.url, link)
  }

  const all = [...byUrl.values()]
  return { links: all.slice(0, MAX_KEPT), dropped: Math.max(0, all.length - MAX_KEPT) }
}

/**
 * The repository's own name, for the label: the last segment of `<owner>/<repo>`.
 *
 * A session usually works in one repository, so `#170` alone would be ambiguous
 * the moment it opens a PR against two — which this one does. The owner is left
 * out because it is the same for every repository in an org and only makes the
 * line longer.
 */
function repoName(link: PullRequest): string | undefined {
  const name = link.repo?.split('/').filter(segment => segment !== '').at(-1)
  return name === undefined || name === '' ? undefined : name
}

/**
 * What the band draws: one entry per remembered pull request, newest first,
 * label and URL as **separate fields**. Empty when there is nothing to show.
 *
 * Every link is drawn rather than the newest plus a count, because the count
 * hides which pull requests the older ones are — the reason to remember them at
 * all.
 *
 * The URL must never be concatenated into a string handed to `$.ui.status`.
 * That call takes plain text, and raw ESC bytes in it make the engine emit a
 * `⚠ <plugin>: …` line showing the escapes on every repaint. Terminals do
 * support OSC 8; the status field is what refuses it cleanly. A `Link` element
 * is the documented hyperlink and the engine escapes it itself.
 */
export function statusLinks(state: PrLinks): { label: string; url?: string }[] {
  if (state.isHidden) return []
  if (state.links.length === 0) return []

  const drawn: { label: string; url?: string }[] = state.links.map(link => {
    // `<repo> #<number>`, e.g. `lumora-infra #170`. Without a number the
    // repository alone is all there is to say; without a repository the host
    // is the only thing that distinguishes it.
    const name = repoName(link) ?? link.host
    return {
      label: link.number === undefined ? name : `${name} #${link.number}`,
      url: link.url,
    }
  })

  // What fell off the end is announced, not swallowed: a session that opened
  // more than `MAX_KEPT` would otherwise look like it opened exactly that many.
  const dropped = state.dropped ?? 0
  if (dropped > 0) drawn.push({ label: `+${dropped} more` })

  return drawn
}

