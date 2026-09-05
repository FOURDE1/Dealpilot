import type { FastifyInstance } from 'fastify';
import { withTenant, withUser, type Pool, type PoolClient } from '@dealpilot/db';
import { CreateExpenseInput, UpdateExpenseInput, type ExpenseStatusT } from '@dealpilot/schemas';
import { AppError, notFound, parseOrThrow } from './errors.js';
import { requirePermission } from './permissions.js';
import { idParam, requireMember, sessionUser } from './f01-routes.js';
import { diff, recordEvent } from './activity.js';
import { costAllowed, costViewOf, vehicleOrg, type CostView } from './f07-vehicles-routes.js';
import { ALLOWED_CONTENT_TYPES, receiptKey, sha256, type StorageDriver } from './storage.js';

/**
 * F-82 — the vehicle expenses ledger (expenses-accounting.md §1–§5, §7, §8;
 * FR-ACC-002/003/004 P1 + FR-ACC-001's category half; D-084).
 *
 * THE MONEY FENCE. A record and a report input, NEVER a desk input. Nothing
 * here writes a vehicle cost column, a deal input, an engine output, the
 * funding track or a commission; the derived vehicle total stays f07's three
 * columns and this module never derives a vehicle cost at all. The car page
 * adds the ledger's approved sum BESIDE that total, captioned — the worksheet
 * copies the total, never that figure. Pinned statically by
 * f82-money-fence.test.ts and behaviourally by f82-expenses.test.ts T-F1–T-F3.
 *
 * AUTHORITY. Logging, editing while pending and attaching a receipt run under
 * `vehicle:update` (lot work — the recon field's authority). Approve, reject,
 * pay and void — every transition, pending → void included — run under the
 * new `expense:approve` verb AND require the actor's cost view (f07's
 * costViewOf, FR-TEN-006) to cover the vehicle's store: you cannot approve a
 * number you cannot read (403 cost_masked). Reads are member-wide; the money
 * fields and the receipt metadata are ABSENT (never null) for a masked
 * caller and `summary` is absent when the store is masked — a masked HOLDER
 * of vehicle:update may log and gets a masked 201 (the shipped recon
 * asymmetry: write authority ≠ read authority). The receipt IS the amount,
 * so its download is a 404 for a masked caller.
 *
 * THE LADDER (route-enforced; 0075's CHECK is the vocabulary only): pending →
 * approved | rejected | void; approved → paid | void; paid → void; rejected
 * and void are terminal. A same-status PATCH is a 200 no-op for status (an
 * idempotent double-click writes no event); any other pair is a 422
 * invalid_transition — state before actor, the f11/f13 spelling (f11's 409
 * run_ended terminal door is NOT copied). Field edits (category, vendor_name,
 * invoice_number, expense_date, description) only while pending — 422
 * expense_not_pending. Amounts are INSERT-only: never in UpdateExpenseInput,
 * never in PATCHABLE, never in a SET — void + re-log is the correction door,
 * so the approver always approves the number that was logged and the trail
 * carries no money by construction (F-79: events carry status and facts,
 * activity:read is floor-wide).
 *
 * THE LOCK LAW. No f82 transaction writes a second table, so the uniform
 * law is ONE row: every id-addressed write locks its own expense row THROUGH
 * the read model (`${SELECT_ROW} WHERE e.id = $1 FOR UPDATE OF e`) after
 * requirePermission, and holds no second connection — the cost view is
 * resolved BEFORE the transaction (f07's order at every site; costViewOf
 * opens its own transaction and a nested checkout under a row lock would
 * self-deadlock the pool). POST takes no vehicle lock: the composite FK's
 * KEY SHARE is the only lock the INSERT needs. Every write first proves the
 * vehicle is live: POST via vehicleOrg (already `deleted_at IS NULL`) plus
 * liveVehicle; PATCH and the receipt via liveVehicle after the row lock. A
 * soft-deleted car refuses new ledger writes (404 through liveVehicle on
 * POST, PATCH and receipt POST); an overlapping DELETE is tolerated — the
 * orphan row is inert and unreachable through the vehicle (vehicleOrg is
 * already 404). No vehicle lock is added for that race.
 *
 * REFUSAL ORDER. The receipt POST checks content-type (415) and the empty
 * body (422 empty_file) BEFORE the org walk (f13-document-routes.ts:129-143's
 * order, copied verbatim), so a stranger learns 415 before 404 on that one
 * route. The two body routes (POST, PATCH) parse the body FIRST — a stranger
 * with a malformed payload learns 422 about their own body, nothing about
 * the row — then 404 (org walk) → 403 → 422 state; the body-less routes are
 * 404 (org walk) → 403 → 422 state. The upload replies 201 (f13-document-routes.ts:199); the download's
 * hash recheck is 409 content_mismatch (f13:229). `conflictFrom` is called
 * nowhere: 0075 has no unique constraint, and organization_id / store_id are
 * copied from the live vehicle inside the tenant transaction, so no 23503 is
 * reachable through these routes.
 *
 * expense_date is a `date` column and pg has no DATE parser (the f07
 * localDate / F-81 expiry_date lesson): every read goes through SELECT_ROW,
 * which serializes it as 'YYYY-MM-DD', so the POST echo, the PATCH `after`
 * and the trail's from/to all carry the same string.
 */

/** The one read model — explicit columns, never `e.*`: the storage key never travels on the wire. */
const SELECT_ROW =
  `SELECT e.id, e.organization_id, e.store_id, e.vehicle_id, e.category, e.vendor_name,
          e.amount_cents, e.tax_cents, e.total_cents, e.invoice_number,
          e.expense_date::text AS expense_date, e.description, e.status,
          e.receipt_content_sha256, e.receipt_content_type, e.receipt_size_bytes,
          e.created_at, e.updated_at
   FROM vehicle_expenses e`;

/** Deleted (never nulled) from a row the caller's cost view does not cover — a receipt IS the amount. */
const MONEY_FIELDS = [
  'amount_cents', 'tax_cents', 'total_cents',
  'receipt_content_sha256', 'receipt_content_type', 'receipt_size_bytes',
] as const;

/** The ladder: prior → the statuses it may move to. Absent pair = 422 invalid_transition. */
const EXPENSE_TRANSITIONS: Record<ExpenseStatusT, readonly ExpenseStatusT[]> = {
  pending: ['approved', 'rejected', 'void'],
  approved: ['paid', 'void'],
  paid: ['void'],
  rejected: [],
  void: [],
};

/** Belt-and-braces at the SINK (f80/f81's guard): schema-bounded keys,
 * re-bounded where they reach identifier position. NO amounts, NO receipt_*,
 * NO stamps — the receipt route writes its four columns by name. */
const PATCHABLE = new Set([
  'status', 'category', 'vendor_name', 'invoice_number', 'expense_date', 'description',
]);

type Row = Record<string, unknown>;

function maskExpense(row: Row, view: CostView): Row {
  if (costAllowed(String(row['store_id']), view)) return row;
  const out = { ...row };
  for (const f of MONEY_FIELDS) delete out[f];
  return out;
}

/** f80's lenderOrg shape: iterate the caller's orgs under withTenant; a
 * rival's (or unknown) expense id is a 404. No new RLS policy — the one
 * org-keyed isolation policy is the only door. */
async function expenseOrg(pool: Pool, userId: string, expenseId: string): Promise<string> {
  const orgs = await withUser(pool, userId, async (c) => {
    const r = await c.query<{ organization_id: string }>(
      `SELECT DISTINCT organization_id FROM memberships WHERE status = 'active'`,
    );
    return r.rows.map((x) => x.organization_id);
  });
  for (const orgId of orgs) {
    const found = await withTenant(pool, orgId, async (c) => {
      const r = await c.query('SELECT 1 FROM vehicle_expenses WHERE id = $1', [expenseId]);
      return r.rows.length > 0;
    });
    if (found) return orgId;
  }
  throw notFound();
}

/** The car must be live — a soft-deleted car's ledger is closed to writes. Returns its store. */
async function liveVehicle(c: PoolClient, vehicleId: string): Promise<string> {
  const r = await c.query<{ store_id: string }>(
    `SELECT store_id FROM vehicles WHERE id = $1 AND deleted_at IS NULL`,
    [vehicleId],
  );
  if (r.rows.length === 0) throw notFound();
  return r.rows[0]!.store_id;
}

async function readRow(c: PoolClient, id: string, lock = false): Promise<Row> {
  const r = await c.query<Row>(`${SELECT_ROW} WHERE e.id = $1${lock ? ' FOR UPDATE OF e' : ''}`, [id]);
  if (r.rows.length === 0) throw notFound();
  return r.rows[0]!;
}

export function registerF82Routes(app: FastifyInstance, pool: Pool, storage: StorageDriver): void {
  app.get('/api/v1/vehicles/:id/expenses', async (request, reply) => {
    const vehicleId = idParam(request);
    const user = sessionUser(request);
    const orgId = await vehicleOrg(pool, user.id, vehicleId);
    const view = await costViewOf(pool, user.id, orgId);
    const body = await withTenant(pool, orgId, async (c) => {
      // Members read: the floor may see that a car was detailed, not what it cost.
      await requireMember(c, user.id);
      const storeId = await liveVehicle(c, vehicleId);
      const rows = await c.query<Row>(
        `${SELECT_ROW} WHERE e.vehicle_id = $1 ORDER BY e.expense_date DESC, e.created_at DESC, e.id`,
        [vehicleId],
      );
      // « Dépenses ajoutées » = approved + paid (spec §2); pending apart;
      // rejected and void in NO sum. Present only when the store is in view —
      // a masked caller gets no summary at all, never {0, 0}.
      if (!costAllowed(storeId, view)) return { items: rows.rows.map((r) => maskExpense(r, view)) };
      const sums = await c.query<{ approved: string; pending: string }>(
        `SELECT COALESCE(SUM(total_cents) FILTER (WHERE status IN ('approved','paid')), 0)::bigint::text AS approved,
                COALESCE(SUM(total_cents) FILTER (WHERE status = 'pending'), 0)::bigint::text AS pending
         FROM vehicle_expenses WHERE vehicle_id = $1`,
        [vehicleId],
      );
      return {
        items: rows.rows,
        summary: { approved_cents: Number(sums.rows[0]!.approved), pending_cents: Number(sums.rows[0]!.pending) },
      };
    });
    return reply.send(body);
  });

  app.post('/api/v1/vehicles/:id/expenses', async (request, reply) => {
    const vehicleId = idParam(request);
    const input = parseOrThrow(CreateExpenseInput, request.body);
    const user = sessionUser(request);
    const orgId = await vehicleOrg(pool, user.id, vehicleId);
    const view = await costViewOf(pool, user.id, orgId);
    const row = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'vehicle:update');
      const storeId = await liveVehicle(c, vehicleId);
      const r = await c.query<{ id: string }>(
        `INSERT INTO vehicle_expenses
           (organization_id, store_id, vehicle_id, category, vendor_name,
            amount_cents, tax_cents, invoice_number, expense_date, description)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [
          orgId, storeId, vehicleId, input.category, input.vendor_name,
          input.amount_cents, input.tax_cents ?? 0, input.invoice_number ?? null,
          input.expense_date, input.description ?? null,
        ],
      );
      const id = r.rows[0]!.id;
      // The trail: facts, never the amount.
      await recordEvent(c, {
        organizationId: orgId,
        storeId,
        actorUserId: user.id,
        entityType: 'vehicle_expense',
        entityId: id,
        action: 'created',
        parentEntityType: 'vehicle',
        parentEntityId: vehicleId,
        changes: { category: input.category, vendor_name: input.vendor_name, expense_date: input.expense_date },
      });
      return readRow(c, id);
    });
    // A masked WRITER gets the row without its money (the recon-field precedent).
    return reply.status(201).send(maskExpense(row, view));
  });

  app.patch('/api/v1/expenses/:id', async (request, reply) => {
    const id = idParam(request);
    const input = parseOrThrow(UpdateExpenseInput, request.body);
    const user = sessionUser(request);
    const orgId = await expenseOrg(pool, user.id, id);
    const view = await costViewOf(pool, user.id, orgId);
    const row = await withTenant(pool, orgId, async (c) => {
      const fieldKeys = Object.keys(input).filter(
        (k) => k !== 'status' && (input as Record<string, unknown>)[k] !== undefined,
      );
      // Two literal gate lines, no ternary (the drift guard reads literals):
      // fields are lot work; a status key — any status key, the same one
      // included — is the manager's door.
      if (fieldKeys.length > 0) await requirePermission(c, user.id, 'vehicle:update');
      if (input.status !== undefined) await requirePermission(c, user.id, 'expense:approve');

      const prior = await readRow(c, id, true);
      await liveVehicle(c, String(prior['vehicle_id']));
      const priorStatus = prior['status'] as ExpenseStatusT;

      if (fieldKeys.length > 0 && priorStatus !== 'pending') {
        throw new AppError(422, 'expense_not_pending', 'Only a pending expense can be edited', [
          { path: 'status', code: 'expense_not_pending', message: priorStatus },
        ]);
      }
      if (input.status !== undefined && input.status !== priorStatus) {
        if (!EXPENSE_TRANSITIONS[priorStatus].includes(input.status)) {
          throw new AppError(422, 'invalid_transition', 'This status change is not allowed', [
            { path: 'status', code: 'invalid_transition', message: `${priorStatus} → ${input.status}` },
          ]);
        }
        // You cannot approve a number you cannot read: a store-B manager
        // does not release store A's money.
        if (!costAllowed(String(prior['store_id']), view)) {
          throw new AppError(403, 'forbidden', 'You cannot approve an amount your role does not see', [
            { path: 'store_id', code: 'cost_masked', message: String(prior['store_id']) },
          ]);
        }
      }

      const sets: string[] = [];
      const params: unknown[] = [id];
      for (const [key, value] of Object.entries(input)) {
        if (value === undefined) continue;
        if (!PATCHABLE.has(key)) throw new Error(`unpatchable column reached the SQL sink: ${key}`);
        // A same-status PATCH is a no-op for status: nothing to SET, no event.
        if (key === 'status' && value === priorStatus) continue;
        params.push(value);
        sets.push(`${key} = $${params.length}`);
      }
      if (sets.length === 0) return prior;
      const upd = await c.query<{ id: string }>(
        `UPDATE vehicle_expenses SET ${sets.join(', ')} WHERE id = $1 RETURNING id`,
        params,
      );
      if (upd.rows.length === 0) throw notFound();
      const after = await readRow(c, id);

      // The trail: only what changed, over PATCHABLE — an amount can never be
      // in it because an amount can never be in a PATCH.
      const changes = diff(prior, after, [...PATCHABLE]);
      if (Object.keys(changes).length > 0) {
        await recordEvent(c, {
          organizationId: orgId,
          storeId: String(after['store_id']),
          actorUserId: user.id,
          entityType: 'vehicle_expense',
          entityId: id,
          action: 'updated',
          parentEntityType: 'vehicle',
          parentEntityId: String(after['vehicle_id']),
          changes,
        });
      }
      return after;
    });
    return reply.send(maskExpense(row, view));
  });

  /** f13c's pair: the invoice's scan, content-addressed, its hash on record. */
  app.post('/api/v1/expenses/:id/receipt', async (request, reply) => {
    const id = idParam(request);
    const contentType = String(request.headers['content-type'] ?? '').split(';')[0]!.trim();
    const extension = ALLOWED_CONTENT_TYPES[contentType];
    if (!extension) {
      throw new AppError(415, 'unsupported_media_type', 'A receipt must be a PDF, JPEG or PNG', [
        { path: 'content-type', code: 'unsupported_media_type', message: contentType || '(none)' },
      ]);
    }
    const body = request.body;
    if (!Buffer.isBuffer(body) || body.byteLength === 0) {
      throw new AppError(422, 'empty_file', 'The uploaded file is empty', [
        { path: 'body', code: 'empty_file', message: 'no bytes' },
      ]);
    }

    const user = sessionUser(request);
    const orgId = await expenseOrg(pool, user.id, id);
    const view = await costViewOf(pool, user.id, orgId);
    const row = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'vehicle:update');
      const prior = await readRow(c, id, true);
      await liveVehicle(c, String(prior['vehicle_id']));
      // A closed line takes no paper; a paid line may (invoices arrive late).
      if (prior['status'] === 'rejected' || prior['status'] === 'void') {
        throw new AppError(422, 'expense_closed', 'A rejected or voided expense takes no receipt', [
          { path: 'status', code: 'expense_closed', message: String(prior['status']) },
        ]);
      }

      const hash = sha256(body);
      const key = receiptKey(orgId, String(prior['vehicle_id']), id, hash, extension);
      // Stored BEFORE the row is updated (f13's order): a row pointing at a
      // file that was never stored is worse than an orphan object.
      const stored = await storage.put(key, body, contentType);
      await c.query(
        `UPDATE vehicle_expenses
         SET receipt_storage_key = $2, receipt_content_sha256 = $3,
             receipt_content_type = $4, receipt_size_bytes = $5
         WHERE id = $1`,
        [id, stored.key, stored.sha256, contentType, stored.bytes],
      );
      const after = await readRow(c, id);
      // The hash is the point of the record; an identical re-upload is silent.
      if (prior['receipt_content_sha256'] !== stored.sha256) {
        await recordEvent(c, {
          organizationId: orgId,
          storeId: String(after['store_id']),
          actorUserId: user.id,
          entityType: 'vehicle_expense',
          entityId: id,
          action: 'updated',
          parentEntityType: 'vehicle',
          parentEntityId: String(after['vehicle_id']),
          changes: {
            receipt_content_sha256: { from: prior['receipt_content_sha256'] ?? null, to: stored.sha256 },
            receipt_size_bytes: stored.bytes,
          },
        });
      }
      return after;
    });
    return reply.code(201).send(maskExpense(row, view));
  });

  app.get('/api/v1/expenses/:id/receipt', async (request, reply) => {
    const id = idParam(request);
    const user = sessionUser(request);
    const orgId = await expenseOrg(pool, user.id, id);
    const view = await costViewOf(pool, user.id, orgId);
    const meta = await withTenant(pool, orgId, async (c) => {
      await requireMember(c, user.id);
      const r = await c.query<{
        store_id: string; receipt_storage_key: string | null;
        receipt_content_sha256: string | null; receipt_content_type: string | null;
      }>(
        `SELECT store_id, receipt_storage_key, receipt_content_sha256, receipt_content_type
         FROM vehicle_expenses WHERE id = $1`,
        [id],
      );
      if (r.rows.length === 0) throw notFound();
      return r.rows[0]!;
    });
    // Absent for a masked caller, like the number it evidences.
    if (!costAllowed(meta.store_id, view)) throw notFound();
    if (!meta.receipt_storage_key || !meta.receipt_content_sha256) throw notFound();

    const body = await storage.get(meta.receipt_storage_key);
    if (sha256(body) !== meta.receipt_content_sha256) {
      throw new AppError(409, 'content_mismatch', 'The stored receipt does not match its recorded hash', [
        { path: 'id', code: 'content_mismatch', message: id },
      ]);
    }
    return reply.header('content-type', meta.receipt_content_type ?? 'application/octet-stream').send(body);
  });
}
