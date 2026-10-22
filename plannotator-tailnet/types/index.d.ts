/** One of this session's live reviews, as the status line command draws it. */
export type StatusEntry = {
  /** `<project> (<mode>)`, from Plannotator's session list. */
  label: string;
  /** The loopback URL Plannotator opened. */
  local: string;
  /** The tailnet URL, present while `tailscale serve` publishes the review's port. */
  tailnet?: string;
};
