import type { FastifyInstance } from 'fastify';
import { withTenant, withUser, type Pool, type PoolClient } from '@dealpilot/db';
import { CreateSubmissionInput, UpdateSubmissionInput } from '@dealpilot/schemas';
import { AppError, notFound, parseOrThrow } from './errors.js';
import { requirePermission } from './permissions.js';
import { idParam, requireMember, sessionUser } from './f01-routes.js';
import { diff, recordEvent } from './activity.js';
import { notify } from './notifications.js';
import { recomputeDealOutputs } from './deal-outputs.js';
import { requireLenderInOrg, withDerived } from './f05-deals-routes.js';

/**
 * F-81 — the lender submissions ledger, and « Choisir cette approbation »
 * (lenders-billofsale.md §2.1–§2.3; FR-FIN-007's remaining half + FR-FIN-008;
 * D-082).
 *
 * A submission records what a lender ANSWERED on a deal — it never feeds desk
 * math. Selection PROMOTES the chosen row onto the deal: exactly three columns
 * (lender_id, interest_rate_bps ← sell_rate_bps, term_months) and then the ONE
 * engine glue, recomputeDealOutputs (deal-outputs.ts — "a path that changes
 * inputs and does not call this is a bug"). Nothing here touches the outputs
 * by hand, the funding track, the reserve, or commissions; nothing here is pay.
 *
 * AUTHORITY: `deal:update` on every write (the fi-products precedent — the
 * same authority that edits the deal, not a new permission nobody has been
 * granted); reads are member-wide. No DELETE, no deselect endpoint: the free
 * status machine and PATCHable lender_id/platform are the correction doors.
 *
 * THE STATUS MACHINE is free among submitted/approved/conditional/declined.
 * Three path-independent invariants hold instead of a ladder, each a DB
 * CHECK (0074) mirrored here as a 422 on the MERGED row:
 *   (i)  selected ⇒ approved — a PATCH moving the SELECTED row off approved
 *        sets selected=false in the SAME UPDATE; the deal KEEPS its
 *        lender/rate/term as ordinary desk inputs (history keeps its name);
 *   (ii) approved ⇒ conditions empty OR conditions_met (422 conditions_unmet);
 *   (iii) decline_reason ⇒ declined (422 not_declined); leaving declined
 *        clears the reason, visibly, in the event diff.
 * responded_at is stamped on the FIRST entry into approved/conditional/
 * declined and never re-stamped. Entering approved rings the deal's
 * salesperson (never the actor themself).
 *
 * LOCK ORDER. Wherever one transaction takes BOTH deals and deal_submissions,
 * the order is deals → deal_submissions: every f81 write does an unlocked read
 * of the immutable deal_id, then `SELECT … FROM deals … FOR UPDATE`
 * (f05-deals-routes.ts' PATCH statement; f13's fi-products POST), then
 * `SELECT … FROM deal_submissions WHERE id = $1 FOR UPDATE`. Pre-existing deal
 * writers take deals alone (f05 PATCH; the funded path writes commissions
 * under the held deal lock) or reach deals SECOND through a trigger from
 * deal_fi_products / deal_parties (f13 locks the product first; 0025 / 0039)
 * — none of those touch deal_submissions, so no cycle exists. The promotion
 * UPDATE on deals takes FOR KEY SHARE on the lenders row (composite FK,
 * 0073); a concurrent lender rename (UNIQUE(organization_id, name)) waits
 * behind an in-flight select and never deadlocks — it holds no deals or
 * submissions lock. Two concurrent selects serialize on the deals row; under
 * READ COMMITTED the second's deselect sees the first's commit, so the partial
 * unique deal_submissions_one_selected is unreachable through these routes
 * and a 23505 there surfaces as a 500 — no mapped code for a state the routes
 * cannot produce. Because the deal lock carries `deleted_at IS NULL`, a
 * submission of a soft-deleted deal is 404 on POST, PATCH and select.
 *
 * EXPIRED is never stored: EXPIRED_SQL derives it on the deal's STORE clock
 * (F-78's clock law) in every read, and the select gate reads the same
 * boolean — today is selectable, yesterday is not, and chip and gate cannot
 * disagree. expiry_date is a `date` column and pg has no DATE parser (the
 * f07 localDate lesson), so every read serializes it as 'YYYY-MM-DD'.
 */

/** Lapsed on the deal's store clock — ONE derivation for the list and the gate. */
const EXPIRED_SQL =
  `(s.expiry_date IS NOT NULL AND s.expiry_date < (now() AT TIME ZONE st.timezone)::date)`;

/** The one read model — explicit columns, never `s.*` (the JOIN adds `expired`). */
const SELECT_ROW =
  `SELECT s.id, s.organization_id, s.store_id, s.deal_id, s.lender_id, s.platform, s.status,
          s.approval_amount_cents, s.buy_rate_bps, s.sell_rate_bps, s.term_months,
          s.monthly_payment_cents, s.conditions, s.conditions_met, s.decline_reason,
          s.expiry_date::text AS expiry_date, s.selected, s.submitted_at, s.responded_at,
          s.notes, s.created_at, s.updated_at,
          ${EXPIRED_SQL} AS expired
   FROM deal_submissions s
   JOIN deals d ON d.id = s.deal_id
   JOIN stores st ON st.id = d.store_id`;

type Row = Record<string, unknown>;

async function readRow(c: PoolClient, id: string): Promise<Row> {
  const r = await c.query<Row>(`${SELECT_ROW} WHERE s.id = $1`, [id]);
  if (r.rows.length === 0) throw notFound();
  return r.rows[0]!;
}

/** f13's dealOrg: the deal must be visible to the caller and live. */
async function dealOrg(pool: Pool, userId: string, dealId: string): Promise<string> {
  return withUser(pool, userId, async (c) => {
    const r = await c.query<{ organization_id: string }>(
      `SELECT d.organization_id FROM deals d
       JOIN organizations o ON o.id = d.organization_id AND o.deleted_at IS NULL
       WHERE d.id = $1 AND d.deleted_at IS NULL`,
      [dealId],
    );
    if (r.rows.length === 0) throw notFound();
    return r.rows[0]!.organization_id;
  });
}

/** f80's lenderOrg shape: iterate the caller's orgs under withTenant; a
 * rival's (or unknown) submission id is a 404. No new RLS policy — the one
 * org-keyed isolation policy is the only door. */
async function submissionOrg(pool: Pool, userId: string, submissionId: string): Promise<string> {
  const orgs = await withUser(pool, userId, async (c) => {
    const r = await c.query<{ organization_id: string }>(
      `SELECT DISTINCT organization_id FROM memberships WHERE status = 'active'`,
    );
    return r.rows.map((x) => x.organization_id);
  });
  for (const orgId of orgs) {
    const found = await withTenant(pool, orgId, async (c) => {
      const r = await c.query('SELECT 1 FROM deal_submissions WHERE id = $1', [submissionId]);
      return r.rows.length > 0;
    });
    if (found) return orgId;
  }
  throw notFound();
}

/** The deal-first lock every f81 write takes — soft-deleted deals are unreachable. */
async function lockDeal(c: PoolClient, dealId: string): Promise<Row> {
  const r = await c.query<Row>(
    `SELECT * FROM deals WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
    [dealId],
  );
  if (r.rows.length === 0) throw notFound();
  return r.rows[0]!;
}

/** The immutable deal_id, read WITHOUT a lock so the deal is locked first. */
async function dealIdOf(c: PoolClient, submissionId: string): Promise<string> {
  const r = await c.query<{ deal_id: string }>(
    `SELECT deal_id FROM deal_submissions WHERE id = $1`,
    [submissionId],
  );
  if (r.rows.length === 0) throw notFound();
  return r.rows[0]!.deal_id;
}

const RESPONDED = new Set(['approved', 'conditional', 'declined']);
const nonEmpty = (v: unknown): boolean => typeof v === 'string' && v.trim() !== '';

/** Belt-and-braces at the SINK (house pattern, f80): schema-bounded keys,
 * re-bounded where they reach identifier position. `selected` and the stamps
 * are deliberately absent — the server owns them. */
const PATCHABLE = new Set([
  'status', 'lender_id', 'platform', 'buy_rate_bps', 'sell_rate_bps', 'approval_amount_cents',
  'term_months', 'monthly_payment_cents', 'conditions', 'conditions_met', 'decline_reason',
  'expiry_date', 'notes',
]);

/** Invariant (i)'s promoted fields: the selected row and the deal agree on
 * exactly these three, so they lock while selected (422 selected_terms_locked). */
const LOCKED_WHILE_SELECTED = ['sell_rate_bps', 'term_months', 'lender_id'] as const;

export function registerF81Routes(app: FastifyInstance, pool: Pool): void {
  app.get('/api/v1/deals/:id/submissions', async (request, reply) => {
    const dealId = idParam(request);
    const user = sessionUser(request);
    const orgId = await dealOrg(pool, user.id, dealId);
    const rows = await withTenant(pool, orgId, async (c) => {
      // Members read: the floor already sees the deal; nothing here is pay.
      await requireMember(c, user.id);
      const r = await c.query<Row>(
        `${SELECT_ROW} WHERE s.deal_id = $1 ORDER BY s.submitted_at, s.id`,
        [dealId],
      );
      return r.rows;
    });
    return reply.send(rows);
  });

  app.post('/api/v1/deals/:id/submissions', async (request, reply) => {
    const dealId = idParam(request);
    const input = parseOrThrow(CreateSubmissionInput, request.body);
    const user = sessionUser(request);
    const orgId = await dealOrg(pool, user.id, dealId);
    const row = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'deal:update');
      const deal = await lockDeal(c, dealId);
      // A NEW submission never grandfathers: unknown/rival → 422
      // invalid_reference; deactivated → 422 lender_inactive (F-80's law).
      await requireLenderInOrg(c, input.lender_id);
      const r = await c.query<{ id: string }>(
        `INSERT INTO deal_submissions
           (organization_id, store_id, deal_id, lender_id, platform,
            buy_rate_bps, sell_rate_bps, term_months, approval_amount_cents,
            monthly_payment_cents, expiry_date, conditions, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [
          orgId, String(deal['store_id']), dealId, input.lender_id, input.platform,
          input.buy_rate_bps ?? null, input.sell_rate_bps ?? null, input.term_months ?? null,
          input.approval_amount_cents ?? null, input.monthly_payment_cents ?? null,
          input.expiry_date ?? null, input.conditions ?? null, input.notes ?? null,
        ],
      );
      const id = r.rows[0]!.id;
      await recordEvent(c, {
        organizationId: orgId,
        storeId: String(deal['store_id']),
        actorUserId: user.id,
        entityType: 'deal_submission',
        entityId: id,
        action: 'created',
        parentEntityType: 'deal',
        parentEntityId: dealId,
        changes: { lender_id: input.lender_id, platform: input.platform },
      });
      return readRow(c, id);
    });
    return reply.status(201).send(row);
  });

  app.patch('/api/v1/submissions/:id', async (request, reply) => {
    const id = idParam(request);
    const input = parseOrThrow(UpdateSubmissionInput, request.body);
    const user = sessionUser(request);
    const orgId = await submissionOrg(pool, user.id, id);
    const row = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'deal:update');
      // The uniform deal-first law, even though this route never writes the
      // deal: one lock order for every f81 transaction, one comment that
      // stays true, one row lock's cost.
      const deal = await lockDeal(c, await dealIdOf(c, id));
      // Locked THROUGH the read model, never `SELECT *`: the trail diffs
      // `prior` against `after` (a readRow), and a raw row's `date` comes back
      // as a pg Date that JSON.stringify turns into a UTC instant of the wrong
      // day east of UTC — the trail read {from: '2030-01-14T22:00:00.000Z',
      // to: '2030-02-01'} for a 15 January expiry. One serialization on both
      // sides (the header's claim, pinned by T-S4's expiry_date trail case).
      const priorR = await c.query<Row>(`${SELECT_ROW} WHERE s.id = $1 FOR UPDATE OF s`, [id]);
      if (priorR.rows.length === 0) throw notFound();
      const prior = priorR.rows[0]!;

      // The selected row's promoted fields are the deal's — edit the
      // worksheet, or move the row back to submitted to correct it.
      if (prior['selected'] === true) {
        const locked = LOCKED_WHILE_SELECTED.filter((k) => input[k] !== undefined);
        if (locked.length > 0) {
          throw new AppError(422, 'selected_terms_locked', 'The chosen approval’s terms are locked', locked.map((k) => ({
            path: k,
            code: 'selected_terms_locked',
            message: 'Edit the worksheet, or move the submission back to submitted to correct it',
          })));
        }
      }
      // The correction door: a wrong-bank mis-log is fixed in place, with NO
      // grandfather — a lender change is a new pick.
      if (input.lender_id !== undefined && input.lender_id !== prior['lender_id']) {
        await requireLenderInOrg(c, input.lender_id);
      }

      const merged: Row = { ...prior };
      for (const [k, v] of Object.entries(input)) if (v !== undefined) merged[k] = v;
      const finalStatus = String(merged['status']);

      // Invariant (ii) on the MERGED row — path-independent, so
      // conditional → submitted → approved dodges nothing.
      if (finalStatus === 'approved' && nonEmpty(merged['conditions']) && merged['conditions_met'] !== true) {
        throw new AppError(422, 'conditions_unmet', 'Tick the conditions met before approving', [
          { path: 'conditions_met', code: 'conditions_unmet', message: 'Conditions are on file and not met' },
        ]);
      }
      // Invariant (iii): a reason arriving with a non-declined final status.
      if (input.decline_reason !== undefined && input.decline_reason !== null && finalStatus !== 'declined') {
        throw new AppError(422, 'validation_failed', 'A decline reason belongs to a declined submission', [
          { path: 'decline_reason', code: 'not_declined', message: 'Set status to declined, or omit the reason' },
        ]);
      }

      const sets: string[] = [];
      const params: unknown[] = [id];
      for (const [key, value] of Object.entries(input)) {
        if (value === undefined) continue;
        if (!PATCHABLE.has(key)) throw new Error(`unpatchable column reached the SQL sink: ${key}`);
        params.push(value);
        sets.push(`${key} = $${params.length}`);
      }
      const statusMoved = input.status !== undefined && input.status !== prior['status'];
      // First response only: never re-stamped, never cleared.
      if (statusMoved && RESPONDED.has(finalStatus) && prior['responded_at'] === null) {
        sets.push('responded_at = now()');
      }
      // Invariant (iii)'s other half: leaving declined clears the reason
      // (visible in the event diff, never silent).
      if (statusMoved && prior['status'] === 'declined' && input.decline_reason === undefined) {
        sets.push('decline_reason = NULL');
      }
      // Invariant (i): the chosen row leaving approved is no longer chosen —
      // in the SAME UPDATE. The deal keeps its lender/rate/term.
      if (statusMoved && prior['selected'] === true) {
        sets.push('selected = false');
      }
      const upd = await c.query<{ id: string }>(
        `UPDATE deal_submissions SET ${sets.join(', ')} WHERE id = $1 RETURNING id`,
        params,
      );
      if (upd.rows.length === 0) throw notFound();
      const after = await readRow(c, id);

      // The trail: only what changed (an empty diff is no event). A
      // deselect-on-leaving-approved rides as selected {true → false}.
      const changes = diff(prior, after, [...PATCHABLE, 'selected']);
      if (Object.keys(changes).length > 0) {
        await recordEvent(c, {
          organizationId: orgId,
          storeId: String(after['store_id']),
          actorUserId: user.id,
          entityType: 'deal_submission',
          entityId: id,
          action: 'updated',
          parentEntityType: 'deal',
          parentEntityId: String(after['deal_id']),
          changes,
        });
      }

      // §2.2 / FR-FIN-008: ENTERING approved rings the deal's salesperson —
      // the one person on the deal who is not in the F&I office. Skipped when
      // the deal names nobody or the actor is that person (the f09
      // no-self-notify precedent). Each entry fires (the machine is free);
      // a same-status re-PATCH does not.
      const salespersonId = (deal['salesperson_id'] as string | null) ?? null;
      if (finalStatus === 'approved' && prior['status'] !== 'approved' && salespersonId && salespersonId !== user.id) {
        const lender = await c.query<{ name: string }>(`SELECT name FROM lenders WHERE id = $1`, [after['lender_id']]);
        const leadId = (deal['lead_id'] as string | null) ?? null;
        const dealId = String(after['deal_id']);
        await notify(c, {
          organizationId: orgId,
          userId: salespersonId,
          urgency: 'medium',
          titleKey: 'notif_lender_submission_approved',
          params: { lender: lender.rows[0]?.name ?? '' },
          // The desking screen IS the deal screen; a deal with no lead has
          // no route to link (never an invented path).
          ...(leadId ? { link: `/leads/${leadId}/desk/${dealId}` } : {}),
          entityType: 'deal_submission',
          entityId: id,
          storeId: String(after['store_id']),
        });
      }
      return after;
    });
    return reply.send(row);
  });

  app.post('/api/v1/submissions/:id/select', async (request, reply) => {
    const id = idParam(request);
    // The contract's body is z.undefined(): the act carries nothing. A client
    // sending fields here is confused about which door it is at, so it is
    // told — an empty `{}` from a JSON client is tolerated as "nothing".
    const body = request.body;
    if (body !== undefined && body !== null && !(typeof body === 'object' && Object.keys(body).length === 0)) {
      throw new AppError(422, 'validation_failed', 'This action takes no body', [
        { path: 'body', code: 'unexpected_body', message: 'POST /submissions/:id/select carries no fields' },
      ]);
    }
    const user = sessionUser(request);
    const orgId = await submissionOrg(pool, user.id, id);
    const result = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'deal:update');
      const dealId = await dealIdOf(c, id);
      // The selection serializer: concurrent selects queue here.
      const deal = await lockDeal(c, dealId);
      const locked = await c.query(`SELECT 1 FROM deal_submissions WHERE id = $1 FOR UPDATE`, [id]);
      if (locked.rows.length === 0) throw notFound();
      // Read back through the one read model so the gate sees the SAME
      // store-clock `expired` the list shows.
      const sub = await readRow(c, id);

      // Eligibility, in refusal order — each its own code (the A-10 lesson:
      // the code is the vocabulary, the message a fallback).
      if (sub['status'] !== 'approved') {
        throw new AppError(422, 'submission_not_approved', 'Only an approval can be chosen', [
          { path: 'status', code: 'submission_not_approved', message: String(sub['status']) },
        ]);
      }
      const missing = (['sell_rate_bps', 'term_months'] as const).filter((k) => sub[k] === null);
      if (missing.length > 0) {
        throw new AppError(422, 'submission_incomplete', 'Sell rate and term are required before selecting', missing.map((k) => ({
          path: k, code: 'submission_incomplete', message: 'Required to promote onto the deal',
        })));
      }
      if (sub['expired'] === true) {
        throw new AppError(422, 'submission_expired', 'This approval has expired', [
          { path: 'expiry_date', code: 'submission_expired', message: 'Update the expiry date if the lender extended' },
        ]);
      }
      // Selecting IS a new lender pick (F-80's law) — with F-80's exact
      // grandfather: the deal that already names this lender is not punished.
      await requireLenderInOrg(c, String(sub['lender_id']), (deal['lender_id'] as string | null) ?? undefined);

      // Deselect-then-select under the deal lock (at most one sibling flips).
      const deselected = await c.query<{ id: string }>(
        `UPDATE deal_submissions SET selected = false WHERE deal_id = $1 AND selected AND id <> $2 RETURNING id`,
        [dealId, id],
      );
      await c.query(`UPDATE deal_submissions SET selected = true WHERE id = $1 AND NOT selected`, [id]);

      // THE PROMOTION — exactly three columns, then the one engine glue.
      // The button means "make the deal match this offer", so a re-select
      // re-promotes over any hand-edit since.
      const promoted = diff(
        deal,
        { lender_id: sub['lender_id'], interest_rate_bps: sub['sell_rate_bps'], term_months: sub['term_months'] },
        ['lender_id', 'interest_rate_bps', 'term_months'],
      );
      await c.query(
        `UPDATE deals SET lender_id = $2, interest_rate_bps = $3, term_months = $4 WHERE id = $1`,
        [dealId, sub['lender_id'], sub['sell_rate_bps'], sub['term_months']],
      );
      await recomputeDealOutputs(c, dealId);

      // The trail: the chosen row's flip, the deselected sibling's OWN flip
      // (it is that row's state change and the deal's timeline must show
      // it), and the deal's promoted from → to — each skipped when nothing
      // changed (a re-select of the chosen row is a no-op on the trail).
      const evt = {
        organizationId: orgId,
        storeId: String(deal['store_id']),
        actorUserId: user.id,
        action: 'updated' as const,
        parentEntityType: 'deal' as const,
        parentEntityId: dealId,
      };
      if (sub['selected'] !== true) {
        await recordEvent(c, {
          ...evt, entityType: 'deal_submission', entityId: id,
          changes: { selected: { from: false, to: true } },
        });
      }
      for (const sibling of deselected.rows) {
        await recordEvent(c, {
          ...evt, entityType: 'deal_submission', entityId: sibling.id,
          changes: { selected: { from: true, to: false } },
        });
      }
      if (Object.keys(promoted).length > 0) {
        await recordEvent(c, {
          organizationId: orgId,
          storeId: String(deal['store_id']),
          actorUserId: user.id,
          entityType: 'deal',
          entityId: dealId,
          action: 'updated',
          changes: { ...promoted, via: 'submission_selected' },
        });
      }

      // Read back post-recompute — the response the panel resyncs FROM.
      const dealAfter = await c.query<Row>(`SELECT * FROM deals WHERE id = $1`, [dealId]);
      return { submission: await readRow(c, id), deal: withDerived(dealAfter.rows[0]!) };
    });
    return reply.send(result);
  });
}
