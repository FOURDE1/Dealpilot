import type { PoolClient } from '@dealpilot/db';
import type { ActivityActionT, ActivityActorTypeT, ActivityEntityTypeT } from '@dealpilot/schemas';

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
  /**
   * The thing this happened UNDER, when the entity is a child: a checklist item
   * belongs to a deal. Lets one query answer "everything that happened to this
   * deal" without the caller knowing which child tables exist (CR-04).
   */
  parentEntityType?: ActivityEntityTypeT;
  parentEntityId?: string;
  /** {"field": {"from": x, "to": y}} — what changed, not the whole row. */
  changes?: Record<string, unknown>;
  reason?: string | null;
  /**
   * F-69 (admin-console.md §12): who acted. Defaults from the actor —
   * a NULL actor is the system, anyone else a tenant member. Tenant routes
   * never pass 'platform'; the 0065 definers write those rows themselves.
   */
  actorType?: ActivityActorTypeT;
  /** §12: hidden from the tenant — only a platform investigation sets it. */
  restricted?: boolean;
}

export async function recordEvent(client: PoolClient, e: EventInput): Promise<void> {
  await client.query(
    `INSERT INTO activity_events
       (organization_id, store_id, actor_user_id, entity_type, entity_id, action,
        changes, reason, parent_entity_type, parent_entity_id, actor_type, restricted)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      e.organizationId,
      e.storeId ?? null,
      e.actorUserId,
      e.entityType,
      e.entityId,
      e.action,
      JSON.stringify(e.changes ?? {}),
      e.reason ?? null,
      e.parentEntityType ?? null,
      e.parentEntityId ?? null,
      e.actorType ?? (e.actorUserId === null ? 'system' : 'tenant'),
      e.restricted ?? false,
    ],
  );
}

/**
 * Compare a stored value against an incoming one. pg hands back shapes that do
 * not `===` their input: `timestamptz` arrives as a Date, `numeric` as a string
 * ("0.2500" for 0.25). A bare String() coercion turns both into a change that
 * never happened — and null vs '' into a change that did happen but is dropped.
 */
/** Local calendar day of a Date, or the date part of a 'YYYY-MM-DD' string. */
function calendarDay(v: unknown): string {
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  return String(v).slice(0, 10);
}

function same(a: unknown, b: unknown): boolean {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull || bNull) return aNull && bNull; // null and '' are NOT the same thing
  if (a instanceof Date || b instanceof Date) {
    // A DATE column arrives from pg as LOCAL midnight; the incoming 'YYYY-MM-DD'
    // parses as UTC midnight. Comparing epochs makes an unchanged date look
    // changed on every save, in every timezone west of UTC — Canada included.
    // Date-only values are therefore compared as calendar days.
    const dateOnly = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (dateOnly(a) || dateOnly(b)) return calendarDay(a) === calendarDay(b);
    const t = (v: unknown) => (v instanceof Date ? v.getTime() : new Date(String(v)).getTime());
    return t(a) === t(b);
  }
  // NOTE: numeric comparison only when BOTH sides look numeric. Coercing one
  // side would make same(false, 0) and same('', 0) true, which would silently
  // drop a real change the first time a boolean- or text-typed column is added.
  const numeric = (v: unknown) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));
  if (numeric(a) && numeric(b)) return Number(a) === Number(b);
  return String(a) === String(b);
}

/**
 * The subset of `next` that actually differs from `before`, as {from, to}.
 * Recording a field that did not change is noise, and noise is what makes an
 * audit trail stop being read.
 */
/**
 * The old value, expressed the way the new one is.
 *
 * Only when the incoming value is a number and the stored one is a numeric
 * STRING — pg's `numeric` rendering. Nothing else is touched: coercing more
 * widely would turn a genuine text-to-number change into a silent no-op, which
 * is the opposite of what an audit trail is for.
 */
function alignType(from: unknown, to: unknown): unknown {
  if (typeof to === 'number' && typeof from === 'string' && from.trim() !== '') {
    const n = Number(from);
    if (Number.isFinite(n)) return n;
  }
  return from ?? null;
}

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
    // Recorded in the SAME shape on both sides. pg hands back `numeric` as a
    // string, so a commission rate edit was landing in the trail as
    // `{ from: '0.2000', to: 0.3 }` — one side text, the other a number, for
    // the same field. Anything reading that back has to guess, and this is the
    // record of who changed someone's pay (found by the pay-plan test the
    // route-coverage guard asked for).
    out[f] = { from: alignType(from, to), to: to ?? null };
  }
  return out;
}
