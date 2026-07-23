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
import { AppError, forbidden, notFound, parseOrThrow } from './errors.js';

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

const STORE_WRITE_ROLES = ['owner', 'gm'] as const;

// -- helpers ----------------------------------------------------------------

/** Session user (the deny-by-default gate guarantees presence on these routes). */
function sessionUser(request: FastifyRequest): { id: string; email: string; name: string } {
  const { user } = request.session!;
  return { id: user.id, email: user.email, name: user.name };
}

function idParam(request: FastifyRequest): string {
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
async function requireMember(client: PoolClient, userId: string, writeRoles?: readonly string[]): Promise<string[]> {
  const roles = await rolesIn(client, userId);
  if (roles.length === 0) throw notFound();
  const alive = await client.query(`SELECT 1 FROM organizations WHERE deleted_at IS NULL`);
  if (alive.rows.length === 0) throw notFound();
  if (writeRoles && !roles.some((r) => writeRoles.includes(r))) throw forbidden();
  return roles;
}

/** Known unique constraints → stable field paths; raw names never leave. */
const CONSTRAINT_PATHS: Record<string, string> = {
  organizations_slug_key: 'slug',
  stores_organization_id_code_key: 'code',
  users_email_key: 'email',
};

/** Postgres unique_violation → canonical 409. */
function conflictFrom(err: unknown): AppError | null {
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

function encodeCursor(createdAtText: string, id: string): string {
  return Buffer.from(JSON.stringify({ c: createdAtText, id }), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): { c: string; id: string } {
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
async function keysetPage<Row extends { id: string }>(
  client: PoolClient,
  baseSql: string,
  params: unknown[],
  page: PageArgs,
): Promise<{ items: Row[]; next_cursor: string | null }> {
  // `_ck` carries created_at at full precision; stripped before the response.
  let sql = baseSql.replace(/^SELECT \*/, 'SELECT *, created_at::text AS _ck');
  const bind = [...params];
  if (page.cursor) {
    const { c, id } = decodeCursor(page.cursor);
    bind.push(c, id);
    sql += ` AND (created_at, id) < ($${bind.length - 1}::timestamptz, $${bind.length})`;
  }
  bind.push(page.limit + 1);
  sql += ` ORDER BY created_at DESC, id DESC LIMIT $${bind.length}`;
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
async function callerOrgIds(client: PoolClient): Promise<string[]> {
  const r = await client.query<{ organization_id: string }>(
    `SELECT DISTINCT m.organization_id FROM memberships m
     JOIN organizations o ON o.id = m.organization_id AND o.deleted_at IS NULL
     WHERE m.status = 'active'`,
  );
  return r.rows.map((x) => x.organization_id);
}

// -- routes -----------------------------------------------------------------

export function registerF01Routes(app: FastifyInstance, pool: Pool): void {
  // ---- organizations ------------------------------------------------------

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
      await requireMember(c, user.id, ['owner']);
      const fields = Object.entries(input);
      if (fields.length === 0) {
        const r = await c.query(`SELECT * FROM organizations WHERE id = $1 AND deleted_at IS NULL`, [orgId]);
        if (r.rows.length === 0) throw notFound();
        return r.rows[0];
      }
      const sets = fields.map(([k], i) => `${k} = $${i + 2}`).join(', ');
      const r = await c.query(
        `UPDATE organizations SET ${sets} WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
        [orgId, ...fields.map(([, v]) => v)],
      );
      if (r.rows.length === 0) throw notFound();
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
      await requireMember(c, user.id, ['owner']);
      await c.query(`UPDATE organizations SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, [orgId]);
    });
    return reply.status(204).send();
  });

  // ---- stores -------------------------------------------------------------

  app.post('/api/v1/stores', async (request, reply) => {
    const input = parseOrThrow(CreateStoreInput, request.body);
    const user = sessionUser(request);
    try {
      const store = await withTenant(pool, input.organization_id, async (c) => {
        await requireMember(c, user.id, STORE_WRITE_ROLES);
        const r = await c.query(
          `INSERT INTO stores (organization_id, name, code, phone, address_line1, city,
                               province, postal_code, default_locale, timezone, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
          [
            input.organization_id, input.name, input.code, input.phone ?? null,
            input.address_line1 ?? null, input.city ?? null, input.province,
            input.postal_code ?? null, input.default_locale, input.timezone, input.status,
          ],
        );
        return r.rows[0];
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
      return keysetPage(
        c,
        `SELECT * FROM stores WHERE organization_id = $1 AND deleted_at IS NULL`,
        [orgId],
        query,
      );
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
      return r.rows[0];
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
        await requireMember(c, user.id, STORE_WRITE_ROLES);
        const fields = Object.entries(input);
        if (fields.length === 0) {
          const r = await c.query(`SELECT * FROM stores WHERE id = $1 AND deleted_at IS NULL`, [storeId]);
          if (r.rows.length === 0) throw notFound();
          return r.rows[0];
        }
        const sets = fields.map(([k], i) => `${k} = $${i + 2}`).join(', ');
        const r = await c.query(
          `UPDATE stores SET ${sets} WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
          [storeId, ...fields.map(([, v]) => v)],
        );
        if (r.rows.length === 0) throw notFound();
        return r.rows[0];
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
      await requireMember(c, user.id, STORE_WRITE_ROLES);
      await c.query(`UPDATE stores SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, [storeId]);
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
