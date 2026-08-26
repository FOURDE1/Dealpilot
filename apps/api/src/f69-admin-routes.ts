import type { FastifyInstance } from 'fastify';
import type { Pool } from '@dealpilot/db';
import {
  AdminTenantEventsQuery,
  AdminTenantListQuery,
  AdminUpdateTenantInput,
  GrantPlatformStaffInput,
  TenantStatusChangeInput,
  type AdminActivityEventT,
  type AdminMeResponseT,
  type AdminTenantDetailT,
  type AdminTenantT,
  type PlanT,
  type PlatformStaffMemberT,
  Uuid,
} from '@dealpilot/schemas';
import { allowedTenantTransitions, tenantRequiresConfirmation, type TenantStatus } from '@dealpilot/core';
import { AppError, notFound, parseOrThrow } from './errors.js';
import { decodeCursor, encodeCursor, idParam, sessionUser } from './f01-routes.js';
import type { Env } from './env.js';
import { platformErrorFrom, requirePlatform } from './platform.js';

/**
 * F-69 — the platform admin console, slice 1 (admin-console.md §3/§4/§11).
 *
 * This file never opens tenant context (none of the tenant-scoped db
 * helpers appear here — the platform-drift guard greps for them). Every
 * read and write goes through the
 * 0065 SECURITY DEFINER surface on a bare pool connection, so a platform
 * staffer never holds tenant RLS context; every handler starts with the
 * CAPABILITY it needs (never a role name), and every definer re-checks the
 * actor itself, so a route mistake cannot widen what the database allows.
 */

type TenantRow = Omit<AdminTenantT, 'plan_code'> & { plan_code: string; created_at_text: string };
type DetailRow = TenantRow & {
  privacy_officer_name: string | null;
  privacy_officer_email: string | null;
  stripe_customer_id: string | null;
  stores: AdminTenantDetailT['stores'];
  owner_emails: string[];
  last_activity_at: Date | null;
};

function tenantOf(row: TenantRow): AdminTenantT {
  const { created_at_text, ...rest } = row;
  void created_at_text;
  return rest as AdminTenantT;
}

/** The definers speak SQLSTATE; the API speaks the error envelope. */
async function definer<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw platformErrorFrom(err) ?? err;
  }
}

export function registerF69Routes(app: FastifyInstance, pool: Pool, env: Env): void {
  async function getTenant(actorId: string, id: string, capabilities: readonly string[]): Promise<AdminTenantDetailT> {
    const r = await definer(() => pool.query<DetailRow>('SELECT * FROM admin_get_tenant($1::uuid, $2::uuid)', [actorId, id]));
    const row = r.rows[0];
    if (!row) throw notFound();
    const { created_at_text, ...rest } = row;
    void created_at_text;
    // A soft-deleted organization has no lifecycle left to drive (every write
    // on it is a 404), so the console offers nothing (review).
    const canTenantTransition = capabilities.includes('tenants:set_status') && row.deleted_at === null;
    return {
      ...(rest as unknown as Omit<AdminTenantDetailT, 'allowed_transitions'>),
      allowed_transitions: canTenantTransition ? allowedTenantTransitions(row.status as TenantStatus) : [],
    };
  }

  app.get('/api/v1/admin/me', async (request, reply) => {
    // The gate did the work; this is what the console renders on boot.
    const actor = request.platform;
    if (!actor) throw notFound();
    const user = sessionUser(request);
    const body: AdminMeResponseT = {
      user: { id: user.id, email: user.email, name: user.name },
      role: actor.role,
      capabilities: actor.capabilities,
      mfa_enabled: true,
      session: {
        created_at: actor.sessionCreatedAt.toISOString(),
        reauth_by: new Date(actor.sessionCreatedAt.getTime() + env.ADMIN_SESSION_MAX_AGE_HOURS * 3_600_000).toISOString(),
      },
    };
    return reply.send(body);
  });

  app.get('/api/v1/admin/plans', async (request, reply) => {
    requirePlatform(request, 'plan:read');
    // Reference data with a SELECT grant, not tenant data — no definer needed.
    const r = await pool.query<PlanT>(
      `SELECT * FROM plans ORDER BY monthly_price_cents_per_store NULLS LAST, code`,
    );
    return reply.send({ items: r.rows });
  });

  app.get('/api/v1/admin/tenants', async (request, reply) => {
    const actor = requirePlatform(request, 'tenants:read');
    const query = parseOrThrow(AdminTenantListQuery, request.query);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const r = await definer(() =>
      pool.query<TenantRow>(
        'SELECT * FROM admin_list_tenants($1::uuid, $2::text, $3::text, $4::text, $5::timestamptz, $6::uuid, $7::int)',
        [actor.userId, query.status ?? null, query.plan ?? null, query.q ?? null, cursor?.c ?? null, cursor?.id ?? null, query.limit],
      ),
    );
    const hasMore = r.rows.length > query.limit;
    const rows = hasMore ? r.rows.slice(0, query.limit) : r.rows;
    const last = rows[rows.length - 1];
    return reply.send({
      items: rows.map(tenantOf),
      next_cursor: hasMore && last ? encodeCursor(last.created_at_text, last.id) : null,
    });
  });

  app.get('/api/v1/admin/tenants/:id', async (request, reply) => {
    const actor = requirePlatform(request, 'tenants:read');
    return reply.send(await getTenant(actor.userId, idParam(request), actor.capabilities));
  });

  app.get('/api/v1/admin/tenants/:id/events', async (request, reply) => {
    const actor = requirePlatform(request, 'tenants:read');
    const id = idParam(request);
    const query = parseOrThrow(AdminTenantEventsQuery, request.query);
    // 404 before events: the trail of a tenant that does not exist is not
    // "an empty list", it is nothing.
    await getTenant(actor.userId, id, actor.capabilities);
    const r = await definer(() =>
      pool.query<Omit<AdminActivityEventT, 'seq'> & { seq: string }>(
        'SELECT * FROM admin_tenant_events($1::uuid, $2::uuid, $3::int)',
        [actor.userId, id, query.limit],
      ),
    );
    // node-postgres hands int8 back as a string; the contract says number.
    return reply.send({ items: r.rows.map((row) => ({ ...row, seq: Number(row.seq) })) });
  });

  app.patch('/api/v1/admin/tenants/:id', async (request, reply) => {
    const id = idParam(request);
    const input = parseOrThrow(AdminUpdateTenantInput, request.body);
    const { reason, ...patch } = input;
    // §3: billing may reprice; only a super admin edits the profile. Decided
    // per KEY, so a billing staffer sending {plan_id} succeeds and one
    // sending {legal_name} is refused — the definer enforces the same split.
    const wantsProfile = Object.keys(patch).some((k) => k !== 'plan_id');
    const actor = wantsProfile
      ? requirePlatform(request, 'tenants:update')
      : requirePlatform(request, 'tenants:set_plan');
    if ('plan_id' in patch) requirePlatform(request, 'tenants:set_plan');
    await definer(() =>
      pool.query('SELECT admin_update_tenant($1::uuid, $2::uuid, $3::jsonb, $4::text)', [
        actor.userId, id, JSON.stringify(patch), reason ?? null,
      ]),
    );
    return reply.send(await getTenant(actor.userId, id, actor.capabilities));
  });

  app.post('/api/v1/admin/tenants/:id/status', async (request, reply) => {
    const actor = requirePlatform(request, 'tenants:set_status');
    const id = idParam(request);
    const input = parseOrThrow(TenantStatusChangeInput, request.body);
    const before = await getTenant(actor.userId, id, actor.capabilities);
    // A destructive target demands the slug typed back — the console's
    // "are you sure" is a fact the person must reproduce, not a checkbox.
    if (tenantRequiresConfirmation(input.status as TenantStatus) && input.confirm_slug !== before.slug) {
      throw new AppError(422, 'validation_failed', 'Type the tenant slug to confirm', [
        { path: 'confirm_slug', code: 'slug_mismatch', message: 'The slug does not match' },
      ]);
    }
    const r = await definer(() =>
      pool.query<{ from_status: string; to_status: string; sessions_revoked: number }>(
        'SELECT * FROM admin_set_tenant_status($1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::boolean)',
        [actor.userId, id, input.status, input.expected_from ?? null, input.reason, input.restricted],
      ),
    );
    const after = await getTenant(actor.userId, id, actor.capabilities);
    return reply.send({ ...after, sessions_revoked: r.rows[0]?.sessions_revoked ?? 0 });
  });

  app.get('/api/v1/admin/staff', async (request, reply) => {
    const actor = requirePlatform(request, 'staff:manage');
    const r = await definer(() => pool.query<PlatformStaffMemberT>('SELECT * FROM platform_staff_list($1::uuid)', [actor.userId]));
    return reply.send({ items: r.rows });
  });

  app.post('/api/v1/admin/staff', async (request, reply) => {
    const actor = requirePlatform(request, 'staff:manage');
    const input = parseOrThrow(GrantPlatformStaffInput, request.body);
    const granted = await definer(() =>
      pool.query<{ user_id: string; outcome: string }>(
        'SELECT * FROM platform_staff_grant($1::uuid, $2::text, $3::text, $4::text)',
        [actor.userId, input.email, input.role, input.note ?? null],
      ),
    );
    const roster = await definer(() => pool.query<PlatformStaffMemberT>('SELECT * FROM platform_staff_list($1::uuid)', [actor.userId]));
    const member = roster.rows.find((m) => m.user_id === granted.rows[0]?.user_id);
    if (!member) throw notFound();
    return reply.status(201).send({ ...member, outcome: granted.rows[0]!.outcome });
  });

  app.delete('/api/v1/admin/staff/:userId', async (request, reply) => {
    const actor = requirePlatform(request, 'staff:manage');
    const parsed = Uuid.safeParse((request.params as { userId?: string }).userId);
    if (!parsed.success) throw notFound();
    const userId = parsed.data;
    await definer(() => pool.query('SELECT platform_staff_revoke($1::uuid, $2::uuid, $3::text)', [actor.userId, userId, null]));
    return reply.status(204).send();
  });
}
