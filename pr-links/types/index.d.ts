/** One pull/merge request a command printed a URL for. */
export type PullRequest = {
  /** The URL exactly as the command printed it, minus trailing punctuation. */
  url: string;
  /** The host it lives on (`git.lumora.bio`, `github.com`), for a short label. */
  host: string;
  /** `<owner>/<repo>` where the URL spells it, else undefined. */
  repo?: string;
  /** The number in the URL (`27`), undefined for a host that spells none. */
  number?: string;
  /** What the host calls it, for the label. */
  kind: 'pull' | 'merge_request' | 'pull_request';
};

/** Everything the status line and `/pr` draw. */
export type PrLinks = {
  /** Newest first, at most `MAX_KEPT`. */
  links: PullRequest[];
  /** Whether `/pr` took the line down. */
  isHidden: boolean;
};

declare module 'claude-code' {
  interface PluginState {
    'pr-links': { prLinks: PrLinks };
  }
}
