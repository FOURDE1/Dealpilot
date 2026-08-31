import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { withContext, withTenant, withUser, type Pool, type PoolClient } from '@dealpilot/db';
import {
  CreateOrganizationInput,
  CreateStoreInput,
  CursorQuery,
  StoreListQuery,
  UpdateOrganizationInput,
  UpdateStoreInput,
  Uuid,
} from '@dealpilot/schemas';
import { LOST_REASON_DEFAULTS } from '@dealpilot/core';
import { AppError, notFound, parseOrThrow } from './errors.js';
import { refuseByStatus } from './tenant-status.js';
import { ensureTemplate } from './checklist.js';
import { requirePermission, seedPermissions } from './permissions.js';
import { diff, recordEvent } from './activity.js';
import { localDate } from './local-date.js';

/**
 * F-01: organization & store administration routes (apiV1.organizations,
 * apiV1.stores). Tenancy model:
 * - READS run under withUser (0003 user-scoped policies): a caller only ever
 *   sees rows of orgs they hold an ACTIVE membership in — cross-tenant ids
 *   come back empty and are answered 404 (existence never leaked).
 * - WRITES run under withTenant after an in-transaction membership/role check:
 *   org settings need `owner`; store writes need `owner` or `gm`
 *   (indexing-and-rls.md §6). RLS WITH CHECK enforces the org key a second
 *   time below us.
 * - Org CREATE is the self-serve bootstrap (multi-tenancy.md §7): the id is
 *   generated app-side so the org row, the caller's domain user row, and the
 *   `owner` membership commit atomically inside withTenant(newOrgId).
 */


// -- helpers ----------------------------------------------------------------

/** Session user (the deny-by-default gate guarantees presence on these routes). */
export function sessionUser(request: FastifyRequest): { id: string; email: string; name: string } {
  const { user } = request.session!;
  return { id: user.id, email: user.email, name: user.name };
}

export function idParam(request: FastifyRequest): string {
  const parsed = Uuid.safeParse((request.params as { id?: string }).id);
  if (!parsed.success) throw new AppError(422, 'validation_failed', 'Invalid id');
  return parsed.data;
}

/**
 * Distinct active-membership roles of `userId` in the CURRENT tenant txn.
 * The explicit org predicate makes the gate independent of ambient GUC state
 * (defense in depth: a future dual-GUC caller must not widen the scope).
 */
async function rolesIn(client: PoolClient, userId: string): Promise<string[]> {
  const r = await client.query<{ role: string }>(
    `SELECT DISTINCT unnest(roles) AS role FROM memberships
     WHERE user_id = $1 AND status = 'active'
       AND organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid`,
    [userId],
  );
  return r.rows.map((x) => x.role);
}

/**
 * Membership + liveness gate inside a tenant txn: no active membership OR a
 * soft-deleted organization → 404 (never leak). A deleted org is fully locked
 * down — no reads or writes through any tenant path (review 2026-07-24).
 */
/**
 * Membership only. The ROLE parameter is gone: what a person may DO is the
 * catalogue's question now (A-13), and leaving a back door here would let an
 * access rule drift back into a route file.
 */
export async function requireMember(client: PoolClient, userId: string): Promise<string[]> {
  const roles = await rolesIn(client, userId);
  if (roles.length === 0) throw notFound();
  // Explicitly keyed on the tenant GUC: under DUAL context (org + user) the
  // user-scoped read policy also exposes the caller's OTHER organizations, so
  // an unqualified liveness probe could pass on the wrong row (review 2026-07-25).
  const alive = await client.query<{ status: string }>(
    `SELECT status FROM organizations
     WHERE id = NULLIF(current_setting('app.org_id', true), '')::uuid AND deleted_at IS NULL`,
  );
  if (alive.rows.length === 0) throw notFound();
  // F-69: suspended → 403, read_only → 402 on a write (the verb decides).
  refuseByStatus(alive.rows[0]!.status);
  return roles;
}

/** Known unique constraints → stable field paths; raw names never leave. */
const CONSTRAINT_PATHS: Record<string, string> = {
  organizations_slug_key: 'slug',
  stores_organization_id_code_key: 'code',
  users_email_key: 'email',
  // F-07 inventory (CR-02): without these, a duplicate VIN and a duplicate
  // stock number are indistinguishable and the UI has to guess which field to
  // flag. Note the VIN rule is a partial unique INDEX, not a table constraint —
  // Postgres still reports its name here.
  vehicles_organization_id_store_id_stock_number_key: 'stock_number',
  idx_vehicles_org_vin: 'vin',
  // F-30's carrier number (0036): a partial unique INDEX, and PLATFORM-WIDE —
  // the holder may be another tenant's rooftop, which is why the 409 carries
  // the field and never the holder. Without this entry the conflict reached
  // the store form with no path, and the form could not place the error.
  idx_stores_sms_number: 'sms_number',
};

/**
 * A store row as the API returns it (F-76).
 *
 * `holiday_dates` is a `date[]`; pg parses each element into a JS Date at
 * SERVER-LOCAL midnight, which JSON then renders as an ISO timestamp a day
 * early on any server ahead of UTC — the 25th read back as the 24th (the F-07
 * `acquisition_date` bug, on an array). Rewritten from LOCAL parts here, at
 * every one of the four store exits (list, get, create, update — including
 * the no-op update), and `Store.holiday_dates` in @dealpilot/schemas admits
 * only `YYYY-MM-DD`, so a fifth exit that forgot this would fail the web's
 * parse and the f01 test in UTC CI too.
 */
function storeRow(row: Record<string, unknown>): Record<string, unknown> {
  const raw = row['holiday_dates'];
  if (!Array.isArray(raw)) return row;
  return { ...row, holiday_dates: raw.map((v: unknown) => (v instanceof Date ? localDate(v) : v)) };
}

/** Postgres unique_violation → canonical 409. */
export function conflictFrom(err: unknown): AppError | null {
  const e = err as { code?: string; constraint?: string };
  if (e?.code !== '23505') return null;
  const path = e.constraint ? CONSTRAINT_PATHS[e.constraint] : undefined;
  return new AppError(409, 'conflict', 'A resource with this unique value already exists', [
    { ...(path ? { path } : {}), code: 'unique_violation', message: 'Already in use' },
  ]);
}

// -- cursor pagination (keyset: created_at DESC, id DESC) -------------------

/**
 * The cursor key is the Postgres TEXT rendering of created_at — full
 * microsecond precision. A JS Date round-trip truncates to milliseconds and
 * silently skips boundary rows on the next page (proven live, review
 * 2026-07-24). The strict pattern also guarantees the value re-parses as
 * timestamptz, so a forged cursor can never surface as a 500.
 */
const PG_TIMESTAMPTZ = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:\d{2})?|Z)$/;
const CursorPayload = z.object({ c: z.string().regex(PG_TIMESTAMPTZ), id: Uuid });

export function encodeCursor(createdAtText: string, id: string): string {
  return Buffer.from(JSON.stringify({ c: createdAtText, id }), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): { c: string; id: string } {
  try {
    return CursorPayload.parse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')));
  } catch {
    throw new AppError(400, 'invalid_cursor', 'The pagination cursor is not valid');
  }
}

interface PageArgs {
  cursor?: string | undefined;
  limit: number;
}

/**
 * Keyset page over `baseSql` (must select * incl. created_at/id and end right
 * before ORDER BY; `params` are its bind values). Fetches limit+1 to compute
 * next_cursor without a count.
 */
export async function keysetPage<Row extends { id: string }>(
  client: PoolClient,
  baseSql: string,
  params: unknown[],
  page: PageArgs,
  /**
   * Table alias owning the sort key, required when the query JOINs and both
   * sides expose created_at/id (e.g. members = memberships JOIN users, where
   * a bare `created_at` is ambiguous). Pass the alias without the dot.
   */
  sortAlias?: string,
): Promise<{ items: Row[]; next_cursor: string | null }> {
  const q = sortAlias ? `${sortAlias}.` : '';
  // `_ck` carries created_at at full precision; stripped before the response.
  // Injected before the first FROM so it works for `SELECT *` AND explicit
  // column lists (e.g. intake-keys omits the `secret` column).
  let sql = baseSql.replace(' FROM ', `, ${q}created_at::text AS _ck FROM `);
  const bind = [...params];
  if (page.cursor) {
    const { c, id } = decodeCursor(page.cursor);
    bind.push(c, id);
    sql += ` AND (${q}created_at, ${q}id) < ($${bind.length - 1}::timestamptz, $${bind.length})`;
  }
  bind.push(page.limit + 1);
  sql += ` ORDER BY ${q}created_at DESC, ${q}id DESC LIMIT $${bind.length}`;
  const r = await client.query<Row & { _ck: string }>(sql, bind);
  const hasMore = r.rows.length > page.limit;
  const rows = hasMore ? r.rows.slice(0, page.limit) : r.rows;
  const lastKey = rows.length ? { c: rows[rows.length - 1]!._ck, id: rows[rows.length - 1]!.id } : null;
  const items = rows.map((row) => {
    const { _ck, ...rest } = row;
    void _ck;
    return rest as unknown as Row;
  });
  return {
    items,
    next_cursor: hasMore && lastKey ? encodeCursor(lastKey.c, lastKey.id) : null,
  };
}

/** The caller's active org ids, live orgs only (self-read policies scope this). */
/**
 * F-42 review (2026-08-19): stores.timezone feeds `AT TIME ZONE` in the
 * cascade's schedule verdict, and Postgres aborts the WHOLE statement (22023)
 * on a name it does not know — one typo'd store would 500 every
 * cascade-assign in the org. Refuse the typo at the door, naming the fix.
 */
export async function assertKnownTimezone(client: PoolClient, timezone: string): Promise<void> {
  // Region/city names only (F-67 review): pg_timezone_names also lists
  // fixed-offset and pseudo zones — 'EST', 'MST', 'Factory', 'Etc/GMT+5' —
  // that Postgres accepts and that carry NO daylight rule. A Québec store
  // saved as 'EST' would bucket every summer message an hour early and
  // read as a real zone in every report that names it.
  const r = await client.query(
    `SELECT 1 FROM pg_timezone_names WHERE name = $1 AND name LIKE '%/%' AND name NOT LIKE 'Etc/%'`,
    [timezone],
  );
  if (r.rows.length === 0) {
    throw new AppError(422, 'validation_failed', 'Unknown timezone', [
      { path: 'timezone', code: 'unknown_timezone', message: `'${timezone}' is not a region/city IANA zone name Postgres recognizes (e.g. America/Montreal — fixed-offset names like EST have no daylight rule)` },
    ]);
  }
}

export async function callerOrgIds(client: PoolClient): Promise<string[]> {
  const r = await client.query<{ organization_id: string }>(
    `SELECT DISTINCT m.organization_id FROM memberships m
     JOIN organizations o ON o.id = m.organization_id AND o.deleted_at IS NULL
       -- F-69: a suspended or closing tenant is not a place its members can
       -- land in by default (implicit single-org resolution).
       AND o.status NOT IN ('suspended','offboarding','purged')
     WHERE m.status = 'active'`,
  );
  return r.rows.map((x) => x.organization_id);
}

// -- routes -----------------------------------------------------------------

export function registerF01Routes(app: FastifyInstance, pool: Pool): void {
  // ---- organizations ------------------------------------------------------

  /** F-53 provisioning: every new organization starts with the nine
   * bilingual lost-reason defaults (leads.md §11) — the first lost lead
   * must find a pick-list, not an empty modal. */
  async function seedLostReasons(c: PoolClient, organizationId: string): Promise<void> {
    await c.query(
      `INSERT INTO lost_reasons (organization_id, name, name_fr, icon, display_order)
       SELECT $1, * FROM unnest($2::text[], $3::text[], $4::text[], $5::int[])`,
      [
        organizationId,
        LOST_REASON_DEFAULTS.map((r) => r.name),
        LOST_REASON_DEFAULTS.map((r) => r.name_fr),
        LOST_REASON_DEFAULTS.map((r) => r.icon),
        LOST_REASON_DEFAULTS.map((_, i) => i + 1),
      ],
    );
  }

  app.post('/api/v1/organizations', async (request, reply) => {
    const input = parseOrThrow(CreateOrganizationInput, request.body);
    const user = sessionUser(request);
    const orgId = randomUUID();
    try {
      // Both GUCs: org for the tenant WITH CHECKs, user for user_self_read —
      // INSERT ... ON CONFLICT also requires the new row to pass the users
      // SELECT policies (0003 migration header).
      const org = await withContext(pool, { orgId, userId: user.id }, async (c) => {
        // status/plan_tier come from the DB defaults — platform authority.
        const inserted = await c.query(
          `INSERT INTO organizations (id, name, slug, default_locale)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [orgId, input.name, input.slug, input.default_locale],
        );
        // Domain user row for the identity (D-025 1:1 link).
        await c.query(
          `INSERT INTO users (id, email, name, status) VALUES ($1, $2, $3, 'active')
           ON CONFLICT (id) DO NOTHING`,
          [user.id, user.email.toLowerCase(), user.name],
        );
        await c.query(
          `INSERT INTO memberships (user_id, organization_id, store_id, roles)
           VALUES ($1, $2, NULL, '{owner}')`,
          [user.id, orgId],
        );
        // The matrix exists before anyone can hit a permission check, so an
        // organization is never briefly one where nobody can do anything.
        await seedPermissions(c, orgId);
        // The lost-reason vocabulary likewise (leads.md §11): the first lost
        // lead must find a pick-list, not an empty modal.
        await seedLostReasons(c, orgId);
        await recordEvent(c, {
          organizationId: orgId, actorUserId: user.id,
          entityType: 'organization', entityId: orgId, action: 'created',
        });
        // The founding owner grant. Every other role grant is recorded; this one
        // is the most consequential of all.
        await recordEvent(c, {
          organizationId: orgId, actorUserId: user.id,
          entityType: 'membership', entityId: user.id, action: 'created',
          changes: { roles: { from: null, to: ['owner'] } },
        });
        return inserted.rows[0];
      });
      return await reply.status(201).send(org);
    } catch (err) {
      throw conflictFrom(err) ?? err;
    }
  });

  app.get('/api/v1/organizations', async (request, reply) => {
    const query = parseOrThrow(CursorQuery, request.query);
    const user = sessionUser(request);
    const page = await withUser(pool, user.id, (c) =>
      keysetPage(c, `SELECT * FROM organizations WHERE deleted_at IS NULL`, [], query),
    );
    return reply.send(page);
  });

  app.get('/api/v1/organizations/:id', async (request, reply) => {
    const orgId = idParam(request);
    const user = sessionUser(request);
    const org = await withTenant(pool, orgId, async (c) => {
      await requireMember(c, user.id);
      const r = await c.query(`SELECT * FROM organizations WHERE id = $1 AND deleted_at IS NULL`, [orgId]);
      if (r.rows.length === 0) throw notFound();
      return r.rows[0];
    });
    return reply.send(org);
  });

  app.patch('/api/v1/organizations/:id', async (request, reply) => {
    const orgId = idParam(request);
    const input = parseOrThrow(UpdateOrganizationInput, request.body);
    const user = sessionUser(request);
    const org = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'organization:update');
      const beforeRow = await c.query<Record<string, unknown>>(
        `SELECT * FROM organizations WHERE id = $1 AND deleted_at IS NULL`,
        [orgId],
      );
      if (beforeRow.rows.length === 0) throw notFound();
      const prior = beforeRow.rows[0]!;

      const fields = Object.entries(input);
      if (fields.length === 0) return prior;
      const sets = fields.map(([k], i) => `${k} = $${i + 2}`).join(', ');
      const r = await c.query<Record<string, unknown>>(
        `UPDATE organizations SET ${sets} WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
        [orgId, ...fields.map(([, v]) => v)],
      );
      if (r.rows.length === 0) throw notFound();
      const changed = diff(prior, input as Record<string, unknown>, Object.keys(input));
      if (Object.keys(changed).length > 0) {
        await recordEvent(c, {
          organizationId: orgId, actorUserId: user.id,
          entityType: 'organization', entityId: orgId, action: 'updated', changes: changed,
        });
      }
      return r.rows[0];
    });
    return reply.send(org);
  });

  app.delete('/api/v1/organizations/:id', async (request, reply) => {
    const orgId = idParam(request);
    const user = sessionUser(request);
    await withTenant(pool, orgId, async (c) => {
      // requireMember's liveness gate makes a repeat delete 404 — the one
      // delete semantic everywhere (soft delete per ADR-009; purge is a
      // platform-side flow later).
      await requirePermission(c, user.id, 'organization:delete');
      const gone = await c.query(
        `UPDATE organizations SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
        [orgId],
      );
      if (gone.rows.length > 0) {
        await recordEvent(c, {
          organizationId: orgId, actorUserId: user.id,
          entityType: 'organization', entityId: orgId, action: 'deleted',
        });
      }
    });
    return reply.status(204).send();
  });

  // ---- stores -------------------------------------------------------------

  app.post('/api/v1/stores', async (request, reply) => {
    const input = parseOrThrow(CreateStoreInput, request.body);
    const user = sessionUser(request);
    try {
      const store = await withTenant(pool, input.organization_id, async (c) => {
        await requirePermission(c, user.id, 'store:create');
        await assertKnownTimezone(c, input.timezone);
        const r = await c.query(
          // Every field the input accepts is in this list. CR-12 was one field
          // accepted here and missing from it — 201, and the value gone.
          `INSERT INTO stores (organization_id, name, code, phone, address_line1, city,
                               province, postal_code, default_locale, timezone, status,
                               bill_of_sale_system, esign_platform,
                               dispatch_conflict_window_hours,
                               business_hours, holiday_dates)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *`,
          [
            input.organization_id, input.name, input.code, input.phone ?? null,
            input.address_line1 ?? null, input.city ?? null, input.province,
            input.postal_code ?? null, input.default_locale, input.timezone, input.status,
            // Same defaults as migration 0023/0017 declare on the columns.
            input.bill_of_sale_system ?? 'CAMS', input.esign_platform ?? null,
            input.dispatch_conflict_window_hours ?? 4,
            JSON.stringify(input.business_hours), input.holiday_dates,
          ],
        );
        // F-08: a new store gets the canonical delivery checklist immediately,
        // so reads never have to write and a deal desked one second later
        // already has something to be measured against.
        await ensureTemplate(c, input.organization_id, String(r.rows[0]!['id']));
        await recordEvent(c, {
          organizationId: input.organization_id,
          storeId: String(r.rows[0]!['id']),
          actorUserId: user.id,
          entityType: 'store',
          entityId: String(r.rows[0]!['id']),
          action: 'created',
        });
        return storeRow(r.rows[0] as Record<string, unknown>);
      });
      return await reply.status(201).send(store);
    } catch (err) {
      throw conflictFrom(err) ?? err;
    }
  });

  app.get('/api/v1/stores', async (request, reply) => {
    const query = parseOrThrow(StoreListQuery, request.query);
    const user = sessionUser(request);
    const page = await withUser(pool, user.id, async (c) => {
      let orgId = query.organization_id;
      if (orgId) {
        // Selector verified: not the caller's LIVE org → 404, never a leak.
        const member = await c.query(
          `SELECT 1 FROM memberships m
           JOIN organizations o ON o.id = m.organization_id AND o.deleted_at IS NULL
           WHERE m.organization_id = $1 AND m.status = 'active' LIMIT 1`,
          [orgId],
        );
        if (member.rows.length === 0) throw notFound();
      } else {
        const orgs = await callerOrgIds(c);
        if (orgs.length === 0) return { items: [], next_cursor: null };
        if (orgs.length > 1) {
          throw new AppError(400, 'organization_required', 'Pass organization_id — you belong to several organizations');
        }
        orgId = orgs[0]!;
      }
      const rows = await keysetPage<Record<string, unknown> & { id: string }>(
        c,
        `SELECT * FROM stores WHERE organization_id = $1 AND deleted_at IS NULL`,
        [orgId],
        query,
      );
      // After keysetPage, which strips `_ck` and hands back raw rows.
      return { ...rows, items: rows.items.map(storeRow) };
    });
    return reply.send(page);
  });

  app.get('/api/v1/stores/:id', async (request, reply) => {
    const storeId = idParam(request);
    const user = sessionUser(request);
    const store = await withUser(pool, user.id, async (c) => {
      const r = await c.query(
        `SELECT s.* FROM stores s
         JOIN organizations o ON o.id = s.organization_id AND o.deleted_at IS NULL
         WHERE s.id = $1 AND s.deleted_at IS NULL`,
        [storeId],
      );
      if (r.rows.length === 0) throw notFound();
      return storeRow(r.rows[0] as Record<string, unknown>);
    });
    return reply.send(store);
  });

  app.patch('/api/v1/stores/:id', async (request, reply) => {
    const storeId = idParam(request);
    const input = parseOrThrow(UpdateStoreInput, request.body);
    const user = sessionUser(request);
    const orgId = await storeOrg(pool, user.id, storeId);
    try {
      const store = await withTenant(pool, orgId, async (c) => {
        await requirePermission(c, user.id, 'store:update');
        if (input.timezone !== undefined) await assertKnownTimezone(c, input.timezone);
        const beforeRow = await c.query<Record<string, unknown>>(
          `SELECT * FROM stores WHERE id = $1 AND deleted_at IS NULL`,
          [storeId],
        );
        if (beforeRow.rows.length === 0) throw notFound();
        // Serialised BEFORE the diff: `diff()` compares by String() and a
        // Date[] never equals a string[], so a holiday PATCH re-sending the
        // same dates would record a change whose `from` side is day-shifted
        // ISO timestamps. Equal `YYYY-MM-DD` arrays compare equal.
        const prior = storeRow(beforeRow.rows[0] as Record<string, unknown>);

        const fields = Object.entries(input);
        if (fields.length === 0) return prior;
        const sets = fields.map(([k], i) => `${k} = $${i + 2}`).join(', ');
        const r = await c.query<Record<string, unknown>>(
          `UPDATE stores SET ${sets} WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
          [storeId, ...fields.map(([, v]) => v)],
        );
        if (r.rows.length === 0) throw notFound();
        const changed = diff(prior, input as Record<string, unknown>, Object.keys(input));
        if (Object.keys(changed).length > 0) {
          await recordEvent(c, {
            organizationId: orgId, storeId, actorUserId: user.id,
            entityType: 'store', entityId: storeId, action: 'updated', changes: changed,
          });
        }
        return storeRow(r.rows[0] as Record<string, unknown>);
      });
      return await reply.send(store);
    } catch (err) {
      throw conflictFrom(err) ?? err;
    }
  });

  app.delete('/api/v1/stores/:id', async (request, reply) => {
    const storeId = idParam(request);
    const user = sessionUser(request);
    const orgId = await storeOrg(pool, user.id, storeId);
    await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'store:delete');
      const gone = await c.query(
        `UPDATE stores SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
        [storeId],
      );
      if (gone.rows.length > 0) {
        await recordEvent(c, {
          organizationId: orgId, storeId, actorUserId: user.id,
          entityType: 'store', entityId: storeId, action: 'deleted',
        });
      }
    });
    return reply.status(204).send();
  });
}

/** Resolve a store's LIVE org through the caller's own visibility (404 if unseen). */
async function storeOrg(pool: Pool, userId: string, storeId: string): Promise<string> {
  return withUser(pool, userId, async (c) => {
    const r = await c.query<{ organization_id: string }>(
      `SELECT s.organization_id FROM stores s
       JOIN organizations o ON o.id = s.organization_id AND o.deleted_at IS NULL
       WHERE s.id = $1 AND s.deleted_at IS NULL`,
      [storeId],
    );
    if (r.rows.length === 0) throw notFound();
    return r.rows[0]!.organization_id;
  });
}
