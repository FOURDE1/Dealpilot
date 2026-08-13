/**
 * @dealpilot/ai — the model-agnostic AI layer (ADR-022).
 *
 * The safety layers ship before any model does: the outbound guard and the
 * prompt-injection defence are deterministic, testable without an API key, and
 * are what make a jailbroken model harmless rather than merely unlikely.
 */
export * from './guards/outbound-guard.js';
export * from './guards/spotlight.js';
