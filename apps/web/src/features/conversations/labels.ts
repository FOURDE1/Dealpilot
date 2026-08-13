import type { ConversationT } from '@dealpilot/schemas';

/**
 * How the console names things (conversation-engine.md §9).
 *
 * Separated from the page so the label coverage guard can import them without
 * pulling in React — a guard nobody can run is a guard nobody runs.
 */

export const STATUS_KEYS = {
  bot_active: 'status_bot_active',
  handed_off: 'status_handed_off',
  agent_active: 'status_agent_active',
  drip_active: 'status_drip_active',
  closed: 'status_closed',
} as const satisfies Record<ConversationT['status'], string>;

/**
 * The AA-gated surface/text pairs, not opacity-derived colours.
 *
 * `bg-destructive/10 text-destructive` looks the same in light mode and is
 * covered by nothing: the palette invariant in packages/ui gates the
 * *-bg / *-text pairs, in BOTH themes. CR-15 shipped a 2.76:1 foreground
 * exactly this way, because the test that should have caught it only looked at
 * one half of the palette.
 */
export const SCORE_CLASS = {
  hot: 'bg-danger-bg text-danger-text',
  warm: 'bg-warning-bg text-warning-text',
  cold: 'bg-muted text-muted-foreground',
} as const satisfies Record<NonNullable<ConversationT['bot_score']>, string>;
