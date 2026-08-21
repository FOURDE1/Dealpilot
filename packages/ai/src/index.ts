/**
 * @dealpilot/ai — the model-agnostic AI layer (ADR-022).
 *
 * The safety layers ship before any model does: the outbound guard and the
 * prompt-injection defence are deterministic, testable without an API key, and
 * are what make a jailbroken model harmless rather than merely unlikely.
 */
export * from './guards/outbound-guard.js';
export * from './guards/spotlight.js';
export * from './prompt/system-prompt.js';
export * from './prompt/inventory-summary.js';
export * from './tools/definitions.js';
export * from './engine/turn.js';
export * from './engine/anthropic.js';
export * from './extraction/lead-extraction.js';
export * from './extraction/anthropic-extraction.js';
export * from './evals/live.js';
export * from './first-touch.js';
