import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, testAdminUrl, testAppUrl, withTenant, withUser } from './index.js';
import { reset } from './migrate.js';
import { ensureTestDatabase } from './test-db.js';

/**
 * RLS smoke test (A-04 DoD): tenant #2 sees NOTHING of tenant #1.
 * Runs against the local Docker Postgres (docker compose up -d db). Skips
 * cleanly when no database is reachable so the suite stays green on machines
 * without Docker; CI runs it against an ephemeral container (A-02/ADR-023).
 *
 * Two pools:
 *  - admin (superuser `dealpilot`): migrations + seeding (bypasses RLS).
 *  - app (`dealpilot_app`): the pool the API will use — FORCE RLS applies.
 */

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const adminUrl = testAdminUrl();
const appUrl = testAppUrl();

let admin: pg.Pool;
let app: pg.Pool;
let dbUp = false;
let org1 = '';
let org2 = '';

beforeAll(async () => {
  await ensureTestDatabase();
  admin = createPool({ connectionString: adminUrl, max: 2 });
  try {
    await admin.query('SELECT 1');
    dbUp = true;
  } catch {
    // In CI the database MUST be present — a silently-skipped suite must fail.
    if (process.env['RLS_REQUIRED']) {
      throw new Error('RLS_REQUIRED is set but no database is reachable');
    }
    return; // no local DB — tests below self-skip
  }
  await reset(admin, migrationsDir, adminUrl);

  const orgs = await admin.query<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES
       ('Kia Mont-Laurier Group', 'kia-mont-laurier'),
       ('Rival Dealer Group', 'rival-group')
     RETURNING id`,
  );
  org1 = orgs.rows[0]!.id;
  org2 = orgs.rows[1]!.id;
  await admin.query(
    `INSERT INTO stores (organization_id, name, code, province) VALUES
       ($1, 'Kia Mont-Laurier', 'KIA-ML', 'QC'),
       ($1, 'ReadyCar Ottawa', 'READY-OTT', 'ON'),
       ($2, 'Rival Store', 'RIVAL-1', 'ON')`,
    [org1, org2],
  );
  const user = await admin.query<{ id: string }>(
    `INSERT INTO users (email, name) VALUES ('hassan@readycar.ca', 'Hassan') RETURNING id`,
  );
  await admin.query(
    `INSERT INTO memberships (user_id, organization_id, store_id, roles) VALUES ($1, $2, NULL, '{owner}')`,
    [user.rows[0]!.id, org1],
  );
  app = createPool({ connectionString: appUrl, max: 2 });
});

afterAll(async () => {
  await admin?.end();
  await app?.end();
});

async function withTenantStore(c: pg.PoolClient): Promise<string> {
  const r = await c.query<{ id: string }>(`SELECT id FROM stores LIMIT 1`);
  return r.rows[0]?.id ?? '00000000-0000-4000-8000-000000000002';
}

describe('row-level security', () => {
  it('tenant 1 sees only its own stores', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const rows = await withTenant(app, org1, async (c) => {
      const r = await c.query<{ code: string }>('SELECT code FROM stores ORDER BY code');
      return r.rows.map((x) => x.code);
    });
    expect(rows).toEqual(['KIA-ML', 'READY-OTT']);
  });

  it('tenant 2 sees nothing of tenant 1', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const rows = await withTenant(app, org2, async (c) => {
      const r = await c.query<{ code: string }>('SELECT code FROM stores ORDER BY code');
      return r.rows.map((x) => x.code);
    });
    expect(rows).toEqual(['RIVAL-1']);
  });

  it('no tenant context = zero rows (fail closed)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const client = await app.connect();
    try {
      const r = await client.query('SELECT count(*)::int AS n FROM stores');
      expect(r.rows[0].n).toBe(0);
    } finally {
      client.release();
    }
  });

  it('cross-tenant UPDATE touches zero rows', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const count = await withTenant(app, org2, async (c) => {
      const r = await c.query(`UPDATE stores SET name = 'hacked' WHERE code = 'KIA-ML'`);
      return r.rowCount;
    });
    expect(count).toBe(0);
  });

  it('staff_schedules: tenant 2 sees nothing of tenant 1, and cannot write into it', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Seed one schedule row for org1 through org1's own tenant context.
    await withTenant(app, org1, async (c) => {
      const store = await c.query<{ id: string }>(`SELECT id FROM stores LIMIT 1`);
      const member = await c.query<{ user_id: string }>(`SELECT user_id FROM memberships LIMIT 1`);
      await c.query(
        `INSERT INTO staff_schedules (organization_id, store_id, user_id, day_of_week, start_time, end_time)
         VALUES ($1, $2, $3, 1, '09:00', '17:00')`,
        [org1, store.rows[0]!.id, member.rows[0]!.user_id],
      );
    });
    const theirs = await withTenant(app, org2, async (c) =>
      (await c.query(`SELECT * FROM staff_schedules`)).rows,
    );
    expect(theirs).toHaveLength(0);
    // WITH CHECK refuses a row smuggled in under the wrong tenant context.
    await expect(
      withTenant(app, org2, async (c) => {
        const store = await withTenantStore(c);
        await c.query(
          `INSERT INTO staff_schedules (organization_id, store_id, user_id, day_of_week, start_time, end_time)
           VALUES ($1, $2, $3, 1, '09:00', '17:00')`,
          [org1, store, '00000000-0000-4000-8000-000000000001'],
        );
      }),
    ).rejects.toThrow();
  });

  it('lead_distribution_config: tenant 2 sees nothing of tenant 1, and cannot write into it', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await withTenant(app, org1, async (c) => {
      const store = await c.query<{ id: string }>(`SELECT id FROM stores LIMIT 1`);
      await c.query(
        `INSERT INTO lead_distribution_config (organization_id, store_id, platform, month, contribution_amount_cents)
         VALUES ($1, $2, 'google', date_trunc('month', now())::date, 100000)`,
        [org1, store.rows[0]!.id],
      );
    });
    const theirs = await withTenant(app, org2, async (c) =>
      (await c.query(`SELECT * FROM lead_distribution_config`)).rows,
    );
    expect(theirs).toHaveLength(0);
    await expect(
      withTenant(app, org2, async (c) => {
        const store = await withTenantStore(c);
        await c.query(
          `INSERT INTO lead_distribution_config (organization_id, store_id, platform, month, contribution_amount_cents)
           VALUES ($1, $2, 'meta', date_trunc('month', now())::date, 1)`,
          [org1, store],
        );
      }),
    ).rejects.toThrow();
  });

  it('notifications: addressed to a person — another tenant sees nothing, another person sees nothing', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const target = await admin.query<{ id: string }>(
      `SELECT user_id AS id FROM memberships LIMIT 1`,
    );
    await withTenant(app, org1, async (c) => {
      await c.query(
        `INSERT INTO notifications (organization_id, user_id, urgency, title_key)
         VALUES ($1, $2, 'low', 'notif_lead_assigned')`,
        [org1, target.rows[0]!.id],
      );
    });
    const rival = await withTenant(app, org2, async (c) =>
      (await c.query(`SELECT * FROM notifications`)).rows,
    );
    expect(rival).toHaveLength(0);
    // The recipient reads their own under USER context alone.
    const mine = await withUser(app, target.rows[0]!.id, async (c) =>
      (await c.query(`SELECT * FROM notifications`)).rows,
    );
    expect(mine.length).toBeGreaterThan(0);
    // A different identity under user context sees nothing at all.
    const stranger = await withUser(app, '00000000-0000-4000-8000-0000000000ff', async (c) =>
      (await c.query(`SELECT * FROM notifications`)).rows,
    );
    expect(stranger).toHaveLength(0);
  });

  it('reset refuses non-local database hosts', async () => {
    await expect(
      reset(admin, migrationsDir, 'postgresql://u:p@prod-rds.ca-central-1.example.com:5432/x'),
    ).rejects.toThrow(/Refusing to reset/);
  });

  it('cross-tenant writes are rejected by WITH CHECK', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await expect(
      withTenant(app, org2, (c) =>
        c.query(
          `INSERT INTO stores (organization_id, name, code, province) VALUES ($1, 'Sneaky', 'SNEAK-1', 'QC')`,
          [org1],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('tenant 1 cannot see the rival organization row', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const names = await withTenant(app, org1, async (c) => {
      const r = await c.query<{ name: string }>('SELECT name FROM organizations');
      return r.rows.map((x) => x.name);
    });
    expect(names).toEqual(['Kia Mont-Laurier Group']);
  });

  it('users are visible only through a membership in the current org', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const inOrg1 = await withTenant(app, org1, async (c) => {
      const r = await c.query('SELECT email FROM users');
      return r.rows.length;
    });
    const inOrg2 = await withTenant(app, org2, async (c) => {
      const r = await c.query('SELECT email FROM users');
      return r.rows.length;
    });
    expect(inOrg1).toBe(1);
    expect(inOrg2).toBe(0);
  });
});
