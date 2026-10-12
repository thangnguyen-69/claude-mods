/** This session's live review, as the band above the prompt draws it. */
export type Band = {
  /** The tailnet URL the review is open at; the link's text and its href. */
  url: string;
};

declare module 'claude-code' {
  interface PluginState {
    'plannotator-tailnet': { band: Band | null };
  }
}
