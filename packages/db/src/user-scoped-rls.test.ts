import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, resolveDatabaseUrl, withUser } from './index.js';
import { reset } from './migrate.js';

/**
 * F-01 user-scoped READ policies: a signed-in user can see the organizations,
 * stores, and memberships they belong to via the `app.user_id` GUC (withUser),
 * WITHOUT tenant context — needed for "list my organizations" before an org is
 * picked. Everything else stays fail-closed: no GUC → no rows, and the user
 * scope never grants writes.
 */

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const adminUrl = resolveDatabaseUrl();
const appUrl = adminUrl.replace(/\/\/[^@]+@/, '//dealpilot_app:dealpilot_app_dev@');

let admin: pg.Pool;
let app: pg.Pool;
let dbUp = false;
let org1 = '';
let org2 = '';
let hassanId = '';
let rivalId = '';

beforeAll(async () => {
  admin = createPool({ connectionString: adminUrl, max: 2 });
  try {
    await admin.query('SELECT 1');
    dbUp = true;
  } catch {
    if (process.env['RLS_REQUIRED']) {
      throw new Error('RLS_REQUIRED is set but no database is reachable');
    }
    return;
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
  const users = await admin.query<{ id: string }>(
    `INSERT INTO users (email, name) VALUES
       ('hassan@readycar.ca', 'Hassan'),
       ('rival@rival.example', 'Rival Owner')
     RETURNING id`,
  );
  hassanId = users.rows[0]!.id;
  rivalId = users.rows[1]!.id;
  await admin.query(
    `INSERT INTO memberships (user_id, organization_id, store_id, roles) VALUES
       ($1, $2, NULL, '{owner}'),
       ($3, $4, NULL, '{owner}')`,
    [hassanId, org1, rivalId, org2],
  );
  app = createPool({ connectionString: appUrl, max: 2 });
});

afterAll(async () => {
  await admin?.end();
  await app?.end();
});

describe('user-scoped reads (F-01)', () => {
  it('a user sees exactly the organizations they belong to', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const slugs = await withUser(app, hassanId, async (c) => {
      const r = await c.query<{ slug: string }>('SELECT slug FROM organizations ORDER BY slug');
      return r.rows.map((x) => x.slug);
    });
    expect(slugs).toEqual(['kia-mont-laurier']);
  });

  it('a user sees only the stores of their own organizations', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const codes = await withUser(app, hassanId, async (c) => {
      const r = await c.query<{ code: string }>('SELECT code FROM stores ORDER BY code');
      return r.rows.map((x) => x.code);
    });
    expect(codes).toEqual(['KIA-ML', 'READY-OTT']);
    const rivalCodes = await withUser(app, rivalId, async (c) => {
      const r = await c.query<{ code: string }>('SELECT code FROM stores ORDER BY code');
      return r.rows.map((x) => x.code);
    });
    expect(rivalCodes).toEqual(['RIVAL-1']);
  });

  it('a user reads their own memberships and nobody else’s', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const rows = await withUser(app, hassanId, async (c) => {
      const r = await c.query<{ organization_id: string }>(
        'SELECT organization_id FROM memberships',
      );
      return r.rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.organization_id).toBe(org1);
  });

  it('no user context still means zero rows (fail closed)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const client = await app.connect();
    try {
      const r = await client.query('SELECT count(*)::int AS n FROM organizations');
      expect(r.rows[0].n).toBe(0);
    } finally {
      client.release();
    }
  });

  it('user scope grants READS only — writes without tenant context are rejected', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await expect(
      withUser(app, hassanId, (c) =>
        c.query(
          `INSERT INTO stores (organization_id, name, code, province)
           VALUES ($1, 'Sneaky', 'SNEAK-1', 'QC')`,
          [org1],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('a user reads their OWN users row and nobody else’s', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const emails = await withUser(app, hassanId, async (c) => {
      const r = await c.query<{ email: string }>('SELECT email FROM users ORDER BY email');
      return r.rows.map((x) => x.email);
    });
    expect(emails).toEqual(['hassan@readycar.ca']);
  });

  it('a revoked membership grants nothing', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await admin.query(`UPDATE memberships SET status = 'revoked' WHERE user_id = $1`, [rivalId]);
    const slugs = await withUser(app, rivalId, async (c) => {
      const r = await c.query<{ slug: string }>('SELECT slug FROM organizations');
      return r.rows.map((x) => x.slug);
    });
    expect(slugs).toEqual([]);
    const stores = await withUser(app, rivalId, async (c) => {
      const r = await c.query('SELECT code FROM stores');
      return r.rows;
    });
    expect(stores).toEqual([]);
  });
});
