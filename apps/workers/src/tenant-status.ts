import { isTenantOperational } from '@dealpilot/core';
import type { PoolClient } from '@dealpilot/db';

/**
 * F-69 — may this tenant's outbound automation run right now?
 *
 * The scheduled scans (drips, task sweep) already exclude non-operational
 * tenants inside their SECURITY DEFINER functions (0065). The EVENT-DRIVEN
 * senders — assistant turns, first touch, deferred sends — are enqueued by
 * earlier events (an inbound SMS still reaches a suspended tenant's number),
 * so each checks here, under its own withTenant, before spending anything.
 * A read_only tenant is not operational (multi-tenancy.md §8); past_due is
 * (§4.2 grace period keeps full functionality).
 */
export async function tenantOperational(c: PoolClient): Promise<boolean> {
  const r = await c.query<{ status: string }>(
    `SELECT status FROM organizations
     WHERE id = NULLIF(current_setting('app.org_id', true), '')::uuid AND deleted_at IS NULL`,
  );
  const status = r.rows[0]?.status;
  return status !== undefined && isTenantOperational(status);
}
