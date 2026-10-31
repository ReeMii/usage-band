/** The last weekly reading: what the engine reported, and when it was taken. */
export type Reading = { percentUsed: number; resetsAt: string; at: number }

declare module 'claude-code' {
  interface PluginState {
    'usage-band': {
      reading: Shaped<Reading | null>
      isFresh: boolean
      minute: number
    }
  }
}
