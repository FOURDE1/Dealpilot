import type { PoolClient } from '@dealpilot/db';
import type { ActivityActionT, ActivityEntityTypeT } from '@dealpilot/schemas';

/**
 * F-10 activity trail (ADR-009). One helper, called inside the transaction that
 * makes the change — never after it, never from a hook that could be skipped.
 *
 * The rule this enforces: if the change rolls back, so does its record; if the
 * change commits, the record committed with it. That is the same discipline
 * F-09 uses to write commissions on funding, and it is the only version of an
 * audit trail that cannot drift from what actually happened.
 */

export interface EventInput {
  organizationId: string;
  storeId?: string | null;
  /** NULL when the system acted (intake webhook, scheduled job) — never faked. */
  actorUserId: string | null;
  entityType: ActivityEntityTypeT;
  entityId: string;
  action: ActivityActionT;
  /** {"field": {"from": x, "to": y}} — what changed, not the whole row. */
  changes?: Record<string, unknown>;
  reason?: string | null;
}

export async function recordEvent(client: PoolClient, e: EventInput): Promise<void> {
  await client.query(
    `INSERT INTO activity_events
       (organization_id, store_id, actor_user_id, entity_type, entity_id, action, changes, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      e.organizationId,
      e.storeId ?? null,
      e.actorUserId,
      e.entityType,
      e.entityId,
      e.action,
      JSON.stringify(e.changes ?? {}),
      e.reason ?? null,
    ],
  );
}

/**
 * Compare a stored value against an incoming one. pg hands back shapes that do
 * not `===` their input: `timestamptz` arrives as a Date, `numeric` as a string
 * ("0.2500" for 0.25). A bare String() coercion turns both into a change that
 * never happened — and null vs '' into a change that did happen but is dropped.
 */
function same(a: unknown, b: unknown): boolean {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull || bNull) return aNull && bNull; // null and '' are NOT the same thing
  if (a instanceof Date || b instanceof Date) {
    const t = (v: unknown) => (v instanceof Date ? v.getTime() : new Date(String(v)).getTime());
    return t(a) === t(b);
  }
  if (typeof a === 'number' || typeof b === 'number') {
    const n = (v: unknown) => Number(v);
    return Number.isFinite(n(a)) && Number.isFinite(n(b)) ? n(a) === n(b) : String(a) === String(b);
  }
  return String(a) === String(b);
}

/**
 * The subset of `next` that actually differs from `before`, as {from, to}.
 * Recording a field that did not change is noise, and noise is what makes an
 * audit trail stop being read.
 */
export function diff(
  before: Record<string, unknown>,
  next: Record<string, unknown>,
  fields: readonly string[],
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const f of fields) {
    if (!(f in next) || next[f] === undefined) continue;
    const from = before[f];
    const to = next[f];
    if (same(from, to)) continue;
    out[f] = { from: from ?? null, to: to ?? null };
  }
  return out;
}
