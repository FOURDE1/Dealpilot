/**
 * @dealpilot/core — pure business math, INTEGER CENTS everywhere (ADR-009).
 * A-06: tax, amortization/lease, desking, and commission engines ported from
 * the canonical legacy implementations with the audited corrections
 * (gap-analysis §F; commissions-clawbacks.md §11; desking-finance.md §16).
 */
export * from './tax.js';
export * from './finance.js';
export * from './desking.js';
export * from './commission.js';
export * from './dispatch.js';
export * from './documents.js';
export * from './branding.js';
export * from './compliance-keywords.js';
export * from './compliance-consent.js';
export * from './compliance-quiet-hours.js';
export * from './store-hours.js';
export * from './compliance-gate.js';
export * from './compliance-inquiry.js';
export * from './intake-connector.js';
export * from './intake-adf.js';
export * from './handoff.js';
export * from './speed-to-lead.js';
export * from './sms-segments.js';
export * from './lead-scoring.js';
export * from './lead-assignment.js';
export * from './lead-cascade.js';
export * from './lead-distribution.js';
export * from './beback.js';
export * from './lost-reasons.js';
export * from './lead-duplicates.js';
export * from './drip.js';
export * from './tenant-lifecycle.js';
export * from './impersonation.js';
export * from './announcements.js';
