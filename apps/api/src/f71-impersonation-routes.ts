import type { FastifyInstance } from 'fastify';
import type { Pool } from '@dealpilot/db';
import {
  ImpersonationListQuery,
  StartImpersonationInput,
  type AdminTenantMemberT,
  type ImpersonationRequestT,
  type ImpersonationSessionDetailT,
} from '@dealpilot/schemas';
import { IMPERSONATION_TTL_MINUTES } from '@dealpilot/core';
import { parseOrThrow } from './errors.js';
import { idParam, sessionUser } from './f01-routes.js';
import { definer } from './f69-admin-routes.js';
import { supportAccessMessage, type Mailer } from './email.js';
import { readImpersonation, sessionOf, type ImpersonationRow } from './impersonation.js';
import { requirePlatform } from './platform.js';

/**
 * F-71 — the platform console's support sessions (admin-console.md §7, §11;
 * D-072). Five handlers, every one starting with a capability, every write
 * a SECURITY DEFINER call on the bare pool — as in f69/f70, this file never
 * opens tenant context and never spells a tenant role (the platform-drift
 * guard greps for both). `sessionUser(request)` here is the STAFFER: the
 * impersonation gate never swaps the user on an admin route.
 *
 * Starting a session writes the register row, the tenant-visible activity
 * row and the owners' bell rows in one transaction; the owners' email goes
 * out AFTER commit (F-70 parity: a lost mail loses the mail, not the fact).
 */

interface StartRow {
  id: string;
  started_at: Date;
  expires_at: Date;
  org_name: string;
  org_slug: string;
  target_email: string;
  target_name: string;
  owner_emails: string[];
}

interface RequestRow {
  seq: string | number;
  method: string;
  route: string;
  url: string;
  status_code: number;
  at: Date;
}

export function registerF71Routes(app: FastifyInstance, pool: Pool, mailer: Mailer): void {
  app.post('/api/v1/admin/impersonation-sessions', async (request, reply) => {
    const actor = requirePlatform(request, 'impersonation:start_read_only');
    const input = parseOrThrow(StartImpersonationInput, request.body);
    // Two literals, no ternary: the drift guard reads capabilities as written.
    if (input.mode === 'full') requirePlatform(request, 'impersonation:start_full');
    const r = await definer(() =>
      pool.query<StartRow>(
        'SELECT * FROM impersonation_start($1::uuid, $2::text, $3::text, $4::uuid, $5::uuid, $6::text, $7::text, $8::text, $9::text, $10::int)',
        [
          actor.userId, sessionUser(request).email, request.session!.session.id, input.tenant_id, input.target_user_id,
          input.mode, input.reason, input.ticket_ref ?? null, request.ip, IMPERSONATION_TTL_MINUTES,
        ],
      ),
    );
    const born = r.rows[0]!;
    let notified = 0;
    for (const to of born.owner_emails) {
      const sent = await mailer.send(
        supportAccessMessage(to, {
          orgName: born.org_name,
          targetName: born.target_name,
          mode: input.mode,
          reason: input.reason,
          ticketRef: input.ticket_ref ?? null,
          expiresAt: born.expires_at,
        }),
      );
      if (sent) notified += 1;
    }
    // Ids and outcomes only — never the reason.
    request.log.info(
      { impersonationId: born.id, organizationId: input.tenant_id, targetUserId: input.target_user_id, mode: input.mode, ownersNotified: notified },
      'impersonation_started',
    );
    return reply.status(201).send(await readImpersonation(pool, actor.userId, born.id));
  });

  app.get('/api/v1/admin/impersonation-sessions', async (request, reply) => {
    const actor = requirePlatform(request, 'impersonation:manage');
    const query = parseOrThrow(ImpersonationListQuery, request.query);
    const r = await definer(() =>
      pool.query<ImpersonationRow>(
        'SELECT * FROM admin_list_impersonations($1::uuid, $2::uuid, $3::boolean, $4::int)',
        [actor.userId, query.tenant_id ?? null, query.active, query.limit],
      ),
    );
    return reply.send({ items: r.rows.map(sessionOf) });
  });

  app.get('/api/v1/admin/impersonation-sessions/:id', async (request, reply) => {
    const actor = requirePlatform(request, 'impersonation:manage');
    const id = idParam(request);
    const session = await readImpersonation(pool, actor.userId, id);
    const trail = await definer(() =>
      pool.query<RequestRow>('SELECT * FROM admin_impersonation_requests($1::uuid, $2::uuid, $3::int)', [actor.userId, id, 500]),
    );
    // node-postgres hands int8 back as a string; the contract says number.
    const requests: ImpersonationRequestT[] = trail.rows.map((row) => ({
      seq: Number(row.seq),
      method: row.method,
      route: row.route,
      url: row.url,
      status_code: row.status_code,
      at: row.at.toISOString(),
    }));
    const body: ImpersonationSessionDetailT = { ...session, requests };
    return reply.send(body);
  });

  app.delete('/api/v1/admin/impersonation-sessions/:id', async (request, reply) => {
    const actor = requirePlatform(request, 'impersonation:manage');
    const id = idParam(request);
    await definer(() => pool.query('SELECT impersonation_end($1::uuid, $2::uuid)', [actor.userId, id]));
    request.log.info({ impersonationId: id, staffUserId: actor.userId }, 'impersonation_ended');
    // 200 + the closed row rather than 204: the caller sees ended_at / end_reason.
    return reply.send(await readImpersonation(pool, actor.userId, id));
  });

  app.get('/api/v1/admin/tenants/:id/members', async (request, reply) => {
    const actor = requirePlatform(request, 'impersonation:manage');
    const id = idParam(request);
    const r = await definer(() =>
      pool.query<AdminTenantMemberT>('SELECT * FROM admin_list_tenant_members($1::uuid, $2::uuid)', [actor.userId, id]),
    );
    return reply.send({ items: r.rows });
  });
}
