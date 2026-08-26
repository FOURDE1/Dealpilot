import type { FastifyInstance } from 'fastify';
import type { Pool } from '@dealpilot/db';
import {
  ProvisionTenantInput,
  ReissueOwnerInvitationInput,
  type AdminTenantProvisionedT,
  type OwnerInvitationReissuedT,
} from '@dealpilot/schemas';
import { TRIAL_DAYS } from '@dealpilot/core';
import { AppError, parseOrThrow } from './errors.js';
import { assertKnownTimezone, idParam } from './f01-routes.js';
import { definer, readAdminTenant } from './f69-admin-routes.js';
import type { Env } from './env.js';
import { invitationMessage, type Mailer } from './email.js';
import { INVITE_TTL_DAYS, acceptUrl, hashToken, newToken } from './invitation-token.js';
import { provisioningSeeds } from './org-seeds.js';
import { requirePlatform } from './platform.js';

/**
 * F-70 — tenant provisioning, the platform console's slice 2
 * (admin-console.md §4.3, §11; D-071).
 *
 * The birth of a tenant is ONE SECURITY DEFINER call on a bare pool
 * connection (`admin_provision_tenant`, 0066): organization, stores, the
 * permission matrix, lost reasons, per-store checklists, the founding
 * owner's invitation and the audit rows commit together or not at all. As
 * in f69, this file never opens tenant context and never spells a tenant
 * role — the platform-drift guard greps for both; the seat's role literal
 * lives in SQL.
 *
 * The owner seat is an F-12 invitation: the token exists only in this
 * request's memory and the outbound email — never stored (SHA-256 only),
 * never logged by this route (the dev `log` mail transport deliberately
 * writes the message body to pino so the link is reachable locally —
 * email.ts — which is why that transport is never the production one);
 * acceptance is the untouched F-12 path. When the mailer cannot reach the
 * invitee (the dev log transport, a failed send) the link comes back in the
 * response — the CR-05 rule — because a tenant whose owner never gets the
 * link is a tenant nobody can enter.
 */

interface BornRow {
  organization_id: string;
  invitation_id: string;
  store_ids: string[];
  trial_ends_at: Date;
  invitation_expires_at: Date;
}

interface ReissueRow {
  invitation_id: string;
  email: string;
  expires_at: Date;
  revoked_invitation_ids: string[];
}

/**
 * Every store's timezone is checked BEFORE anything is written, on a bare
 * client released before the definer runs (pg_timezone_names carries no
 * RLS). The refusal names the row: `stores.<i>.timezone`.
 */
async function assertStoreTimezones(pool: Pool, stores: readonly { timezone: string }[]): Promise<void> {
  const c = await pool.connect();
  try {
    const known = new Set<string>();
    for (const [i, s] of stores.entries()) {
      if (known.has(s.timezone)) continue;
      try {
        await assertKnownTimezone(c, s.timezone);
      } catch (err) {
        if (err instanceof AppError && err.details) {
          throw new AppError(err.statusCode, err.apiCode, err.message, err.details.map((d) => ({ ...d, path: `stores.${i}.timezone` })));
        }
        throw err;
      }
      known.add(s.timezone);
    }
  } finally {
    c.release();
  }
}

export function registerF70Routes(app: FastifyInstance, pool: Pool, mailer: Mailer, env: Env): void {
  app.post('/api/v1/admin/tenants', async (request, reply) => {
    const actor = requirePlatform(request, 'tenants:create');
    const input = parseOrThrow(ProvisionTenantInput, request.body);
    await assertStoreTimezones(pool, input.stores);

    const token = newToken();
    const { display_name, slug, legal_name, province, default_locale, plan_id, owner_email, owner_name, stores } = input;
    let born: BornRow;
    try {
      const r = await definer(() =>
        pool.query<BornRow>(
          'SELECT * FROM admin_provision_tenant($1::uuid, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6::text, $7::int, $8::int)',
          [
            actor.userId,
            JSON.stringify({ display_name, slug, legal_name, province, default_locale, plan_id }),
            JSON.stringify(stores),
            JSON.stringify({ email: owner_email, name: owner_name }),
            // Built from constants, never from the request body.
            JSON.stringify(provisioningSeeds()),
            hashToken(token),
            TRIAL_DAYS,
            INVITE_TTL_DAYS,
          ],
        ),
      );
      born = r.rows[0]!;
    } catch (err) {
      // PA012 names the code; the form wants the row.
      if (err instanceof AppError && err.details?.[0]?.code === 'duplicate_store_code') {
        const detail = err.details[0];
        const i = stores.findIndex((s) => s.code === detail.message);
        throw new AppError(err.statusCode, err.apiCode, err.message, [{ ...detail, path: i >= 0 ? `stores.${i}.code` : 'stores' }]);
      }
      throw err;
    }

    // After commit only: a crash between commit and send loses the mail, not
    // the tenant — the detail's `owner_invitation` and the reissue endpoint
    // are the recovery. The outcome is logged, never the token (F-12 parity).
    const url = acceptUrl(env.WEB_ORIGIN, token);
    const sent = await mailer.send(invitationMessage(owner_email, url));
    request.log.info(
      { organizationId: born.organization_id, invitationId: born.invitation_id, storeCount: born.store_ids.length, sent },
      'tenant_provisioned',
    );

    const tenant = await readAdminTenant(pool, actor.userId, born.organization_id, actor.capabilities);
    const reachesInvitee = sent && mailer.deliversToRecipient;
    const body: AdminTenantProvisionedT = {
      tenant,
      invitation: {
        id: born.invitation_id,
        email: owner_email,
        name: owner_name,
        expires_at: born.invitation_expires_at.toISOString(),
        expired: false,
        ...(reachesInvitee ? {} : { accept_url: url }),
      },
    };
    return reply.status(201).send(body);
  });

  app.post('/api/v1/admin/tenants/:id/owner-invitation', async (request, reply) => {
    const actor = requirePlatform(request, 'tenants:create');
    const id = idParam(request);
    const input = parseOrThrow(ReissueOwnerInvitationInput, request.body);
    const token = newToken();
    const r = await definer(() =>
      pool.query<ReissueRow>(
        'SELECT * FROM admin_reissue_owner_invitation($1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::int)',
        [actor.userId, id, input.email, input.name ?? null, hashToken(token), INVITE_TTL_DAYS],
      ),
    );
    const row = r.rows[0]!;
    const url = acceptUrl(env.WEB_ORIGIN, token);
    const sent = await mailer.send(invitationMessage(row.email, url));
    request.log.info(
      { organizationId: id, invitationId: row.invitation_id, revoked: row.revoked_invitation_ids.length, sent },
      'owner_invitation_reissued',
    );
    const body: OwnerInvitationReissuedT = {
      id: row.invitation_id,
      email: row.email,
      name: input.name ?? null,
      expires_at: row.expires_at.toISOString(),
      expired: false,
      revoked_invitation_ids: row.revoked_invitation_ids,
      ...(sent && mailer.deliversToRecipient ? {} : { accept_url: url }),
    };
    return reply.status(201).send(body);
  });
}
