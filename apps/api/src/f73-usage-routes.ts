import type { FastifyInstance } from 'fastify';
import type { Pool } from '@dealpilot/db';
import {
  AdminUsageQuery,
  type AdminTenantDetailT,
  type AdminTenantUsageT,
  type AdminUsageAllowancesT,
  type PlanTierT,
} from '@dealpilot/schemas';
import { parseOrThrow } from './errors.js';
import { idParam } from './f01-routes.js';
import { definer, readAdminTenant } from './f69-admin-routes.js';
import type { Env } from './env.js';
import { requirePlatform } from './platform.js';

/**
 * F-73 — the per-tenant usage card and the tenant snapshot (admin-console.md
 * §6, §9, §11; D-074).
 *
 * Two reads, both `tenants:read`: §11 gives usage and snapshot to any platform
 * role, and `tenants:read` is already exactly that set — a `usage:read` beside
 * it would be a capability with no refusal of its own to make.
 *
 * Neither handler writes an audit event. §12 audits mutations, and every admin
 * request already writes the `platform_access` log line (platform.ts); an audit
 * value nothing distinguishes is dead vocabulary.
 *
 * Both go through the 0069 definers on the bare pool, so a platform staffer
 * never holds tenant RLS context, and each definer re-checks the actor itself.
 */

/**
 * `admin_tenant_usage`'s row. `document_bytes` and `sms_segments` are declared
 * bigint and node-postgres hands int8 back as a STRING — the same conversion
 * `admin_tenant_events`' `seq` needs (f69-admin-routes.ts).
 */
interface UsageRow {
  window_start: Date;
  window_end: Date;
  plan_code: string;
  seats_provisioned: number;
  member_count: number;
  store_count: number;
  document_bytes: string;
  members_who_acted: number;
  leads_created: number;
  deals_created: number;
  deals_delivered: number;
  ai_conversations_engaged: number;
  sms_segments: string;
  sms_messages_unsegmented: number;
  ai_first_touch_p95_seconds: number | null;
  ai_first_touch_sample_count: number;
  included_seats: number | null;
  included_sms_segments: number;
  included_ai_conversations: number;
}

/** One rooftop as support reads it — never `stores`, which already means something else. */
export interface StoreHealth {
  id: string;
  name: string;
  code: string;
  status: string;
  timezone: string;
  /** The dealer's own carrier number, not a boolean: it is what a support person checks against the console. */
  sms_number: string | null;
  business_hours_set: boolean;
  traffic_30d: {
    inbound: number;
    outbound: number;
    delivered: number;
    last_message_at: string | null;
  };
}

/** Never `token`, never `secret` — the definer does not project them and neither does this. */
export interface SnapshotIntakeKey {
  id: string;
  store_id: string | null;
  label: string;
  provider: string;
  active: boolean;
  revoked_at: string | null;
  /** `intake_keys.last_used_at`, named for the only thing that moves it. */
  last_lead_accepted_at: string | null;
}

export interface SnapshotCommsConfig {
  org_row_present: boolean;
  store_overrides: number;
  sms_quiet_start: string | null;
  sms_quiet_end: string | null;
  first_touch_quiet_exempt: boolean | null;
  ai_daily_contact_cap: number | null;
}

interface SnapshotRow {
  seats_provisioned: number;
  store_health: StoreHealth[];
  intake_keys: SnapshotIntakeKey[];
  comms_config: SnapshotCommsConfig;
  branding_state: string;
  branding_version: number | null;
  branding_published_at: Date | null;
  connectors_active: number;
}

/**
 * The snapshot on the wire: `AdminTenantDetail` spread whole, plus only what
 * `admin_get_tenant` does not already answer.
 *
 * The three transports are grouped into ONE `platform` object rather than left
 * loose beside tenant fields, because they are identical for every tenant —
 * deployment configuration, not a fact about this dealership. A reader who
 * mistakes them for tenant state would think a per-tenant switch exists.
 */
export interface AdminTenantSnapshotBody extends AdminTenantDetailT {
  seats_provisioned: number;
  store_health: StoreHealth[];
  intake_keys: SnapshotIntakeKey[];
  comms_config: SnapshotCommsConfig;
  branding: { state: string; version: number | null; published_at: string | null };
  connectors_active: number;
  platform: { sms_transport: string; email_transport: string; ai_transport: string };
}

export function registerF73UsageRoutes(app: FastifyInstance, pool: Pool, env: Env): void {
  app.get('/api/v1/admin/tenants/:id/usage', async (request, reply) => {
    const actor = requirePlatform(request, 'tenants:read');
    const id = idParam(request);
    // Parsed BEFORE the database is asked: an unknown period is a client
    // mistake with a 422 and a path, never a definer exception surfacing as a
    // 500 (the PA014 belt inside 0069 is there for a code bug, not for this).
    const query = parseOrThrow(AdminUsageQuery, request.query);
    const r = await definer(() =>
      pool.query<UsageRow>('SELECT * FROM admin_tenant_usage($1::uuid, $2::uuid, $3::text)', [
        actor.userId,
        id,
        query.period,
      ]),
    );
    const row = r.rows[0];
    // The definer raises PA002 → 404 for a tenant that does not exist, so a
    // missing row here would be a definer that returned nothing at all.
    if (!row) throw new Error('admin_tenant_usage returned no row');

    // What the tenant BOUGHT, and only against the month it was bought for. A
    // monthly allowance beside a 90-day count is a lie no caption repairs, so
    // the API refuses to hand the client the two numbers to make it with.
    const allowances: AdminUsageAllowancesT | null =
      query.period === 'mtd'
        ? {
            included_seats: row.included_seats,
            included_sms_segments: row.included_sms_segments,
            included_ai_conversations: row.included_ai_conversations,
          }
        : null;

    const body: AdminTenantUsageT = {
      organization_id: id,
      plan_code: row.plan_code as PlanTierT,
      period: query.period,
      window_start: row.window_start.toISOString(),
      window_end: row.window_end.toISOString(),
      gauges: {
        seats_provisioned: row.seats_provisioned,
        member_count: row.member_count,
        store_count: row.store_count,
        document_bytes: Number(row.document_bytes),
      },
      window_metrics: {
        members_who_acted: row.members_who_acted,
        leads_created: row.leads_created,
        deals_created: row.deals_created,
        deals_delivered: row.deals_delivered,
        ai_conversations_engaged: row.ai_conversations_engaged,
        sms_segments: Number(row.sms_segments),
        sms_messages_unsegmented: row.sms_messages_unsegmented,
        ai_first_touch_p95_seconds: row.ai_first_touch_p95_seconds,
        ai_first_touch_sample_count: row.ai_first_touch_sample_count,
      },
      allowances,
    };
    return reply.send(body);
  });

  app.get('/api/v1/admin/tenants/:id/snapshot', async (request, reply) => {
    const actor = requirePlatform(request, 'tenants:read');
    const id = idParam(request);
    // The tenant's identity, plan, status and stores have exactly ONE producer
    // — `admin_get_tenant`, read through the same helper the detail page uses.
    // A forked org query here would be a second copy free to drift, and it is
    // also what answers 404 before the snapshot definer is ever called.
    const tenant = await readAdminTenant(pool, actor.userId, id, actor.capabilities);
    const r = await definer(() =>
      pool.query<SnapshotRow>('SELECT * FROM admin_tenant_snapshot($1::uuid, $2::uuid)', [actor.userId, id]),
    );
    const row = r.rows[0];
    if (!row) throw new Error('admin_tenant_snapshot returned no row');

    const body: AdminTenantSnapshotBody = {
      ...tenant,
      seats_provisioned: row.seats_provisioned,
      store_health: row.store_health,
      intake_keys: row.intake_keys,
      comms_config: row.comms_config,
      branding: {
        state: row.branding_state,
        version: row.branding_version,
        published_at: row.branding_published_at ? row.branding_published_at.toISOString() : null,
      },
      connectors_active: row.connectors_active,
      platform: {
        sms_transport: env.SMS_TRANSPORT,
        email_transport: env.EMAIL_TRANSPORT,
        ai_transport: env.AI_TRANSPORT,
      },
    };
    return reply.send(body);
  });
}
