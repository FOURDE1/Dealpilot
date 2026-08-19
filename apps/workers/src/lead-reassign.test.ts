import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import type { LeadReassignJobT } from '@dealpilot/contracts';
import { buildApp } from '@dealpilot/api/app';
import { runLeadReassign, type LeadReassignResult } from './lead-reassign.js';

/**
 * F-42.2 — the ten-minute ladder, fired against a real database.
 *
 * The queue is not here on purpose (BullMQ plumbing is index.ts's problem);
 * what is under test is the CLAIM-CHECK semantics of D-046: a job fires and
 * the database decides. Fixtures are built through the product's own routes;
 * the one raw INSERT (an agent's outbound message) is marked where it
 * happens, because the full send path drags in carrier + consent fixtures
 * that f19's own suite owns.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations',
);
const run = Date.now().toString(36);

let admin: Pool;
let workerPool: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
let cookie = '';
let orgId = '';
let storeId = '';
let ownerId = '';

let seq = 800;
function nextPhone(): string {
  seq += 1;
  return `+1514555${String(seq).padStart(4, '0')}`;
}

/** Create a lead and cascade-assign it — the assignment the timer guards. */
async function assignedLead(): Promise<{ leadId: string; assignedTo: string }> {
  const res = await app!.inject({
    method: 'POST', url: '/api/v1/leads', headers: { cookie },
    payload: { organization_id: orgId, store_id: storeId, phone: nextPhone(), source: 'walk_in' },
  });
  expect(res.statusCode, res.body).toBe(201);
  const leadId = (JSON.parse(res.body) as { id: string }).id;
  const cas = await app!.inject({
    method: 'POST', url: `/api/v1/leads/${leadId}/cascade-assign`, headers: { cookie },
  });
  expect(cas.statusCode, cas.body).toBe(200);
  const d = JSON.parse(cas.body) as { outcome: string; user_id: string };
  expect(d.outcome).toBe('assigned');
  return { leadId, assignedTo: d.user_id };
}

function job(leadId: string, assignedTo: string, attempt = 0): LeadReassignJobT {
  return { organization_id: orgId, lead_id: leadId, assigned_to: assignedTo, attempt };
}

async function fire(j: LeadReassignJobT): Promise<{ result: LeadReassignResult; armed: LeadReassignJobT[] }> {
  const armed: LeadReassignJobT[] = [];
  const result = await runLeadReassign(
    { pool: workerPool, armNext: async (next) => { armed.push(next); } },
    j,
  );
  return { result, armed };
}

async function leadRow(leadId: string) {
  const r = await admin.query<Record<string, unknown>>(
    `SELECT assigned_to, assigned_at, assignment_method, assignment_attempts, previous_agents, status
     FROM leads WHERE id = $1`,
    [leadId],
  );
  return r.rows[0]!;
}

beforeAll(async () => {
  await ensureTestDatabase();
  admin = createPool({ connectionString: ADMIN_URL, max: 2 });
  try {
    await admin.query('SELECT 1');
    dbUp = true;
  } catch {
    if (process.env['RLS_REQUIRED']) throw new Error('RLS_REQUIRED set but database unreachable');
    return;
  }
  await reset(admin, migrationsDir, ADMIN_URL);
  ({ app } = await buildApp({ DATABASE_URL: APP_URL, NODE_ENV: 'test' }));
  workerPool = createPool({ connectionString: APP_URL, max: 2 });

  const su = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: `f42t-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Tim Er' },
  });
  const sc = su.headers['set-cookie'];
  cookie = (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');
  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe Minuterie', slug: `groupe-minuterie-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'Minuterie Kia', code: 'MIN-KIA', province: 'QC' },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;
  const me = await app!.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
  ownerId = (JSON.parse(me.body) as { user: { id: string } }).user.id;
});

afterAll(async () => {
  await app?.close();
  await workerPool?.end();
  await admin?.end();
});

describe('the claim check (D-046 #1)', () => {
  it('a job whose agent no longer holds the lead does NOTHING', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const { leadId } = await assignedLead();
    const { result, armed } = await fire(job(leadId, '00000000-0000-4000-8000-000000000099'));
    expect(result).toEqual({ outcome: 'obsolete' });
    expect(armed).toHaveLength(0);
    expect((await leadRow(leadId))['assigned_to']).toBe(ownerId); // untouched
  });

  it('a stale attempt number is the same dead claim', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const { leadId, assignedTo } = await assignedLead();
    const { result } = await fire(job(leadId, assignedTo, 2));
    expect(result).toEqual({ outcome: 'obsolete' });
  });

  it('an outbound AGENT message since assignment discharges the SLA — bot chatter does not', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const { leadId, assignedTo } = await assignedLead();
    // Raw INSERT, stated openly: the full send path needs carrier + consent
    // fixtures that f19's suite owns. The rows are shaped exactly as f19
    // writes them; what is under test is the WORKER's reading of them.
    const conv = await admin.query<{ id: string }>(
      `INSERT INTO conversations (organization_id, store_id, lead_id, phone_e164, channel, status, language, assigned_agent_id)
       VALUES ($1, $2, $3, $4, 'sms', 'handed_off', 'fr', $5) RETURNING id`,
      [orgId, storeId, leadId, nextPhone(), assignedTo],
    );
    // Outbound messages MUST name their consent (the 0031 CHECK is
    // load-bearing even against fixtures) — one implied-inquiry grant serves
    // both message rows below.
    const consent = await admin.query<{ id: string }>(
      `INSERT INTO consent_ledger (organization_id, store_id, lead_id, phone_e164,
                                   channel, scope, consent_type, source, evidence, granted_at, expires_at)
       VALUES ($1, $2, $3, $4, 'sms', 'conversational', 'implied_inquiry', 'webhook_inquiry', '{}'::jsonb, now(), now() + interval '6 months')
       RETURNING id`,
      [orgId, storeId, leadId, nextPhone()],
    );
    await admin.query(
      `INSERT INTO messages (organization_id, conversation_id, direction, sender_type, body, consent_ledger_id)
       VALUES ($1, $2, 'outbound', 'bot', 'Bonjour! Je suis l''assistant.', $3)`,
      [orgId, conv.rows[0]!.id, consent.rows[0]!.id],
    );
    // Bot noise alone: the timer still bites…
    const first = await fire(job(leadId, assignedTo));
    expect(first.result.outcome).not.toBe('contacted');
    // …roll the lead back to the guarded state, then a HUMAN answers.
    await admin.query(
      `UPDATE leads SET assigned_to = $2, assigned_at = now(), assignment_attempts = 0,
        previous_agents = '[]'::jsonb, status = 'assigned' WHERE id = $1`,
      [leadId, assignedTo],
    );
    await admin.query(
      `INSERT INTO messages (organization_id, conversation_id, direction, sender_type, body, consent_ledger_id)
       VALUES ($1, $2, 'outbound', 'agent', 'Bonjour, c''est Tim du concessionnaire!', $3)`,
      [orgId, conv.rows[0]!.id, consent.rows[0]!.id],
    );
    const second = await fire(job(leadId, assignedTo));
    expect(second.result).toEqual({ outcome: 'contacted' });
    expect(second.armed).toHaveLength(0);
  });
});

describe('the ladder (leads.md §5.2)', () => {
  it('strike 1: taken away with the ledger entry, re-funnelled, next rung armed', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const { leadId, assignedTo } = await assignedLead();
    const { result, armed } = await fire(job(leadId, assignedTo));
    // Sole member: the funnel excludes the previous agent, finds nobody, and
    // its own escalation hands the lead to the manager — who IS that same
    // owner (the burned-ladder rule). The METHOD tells the truth about how.
    expect(result.outcome).toBe('escalated');
    const row = await leadRow(leadId);
    expect(row['assignment_attempts']).toBe(1);
    expect(row['assignment_method']).toBe('escalation');
    const ledger = row['previous_agents'] as Array<Record<string, unknown>>;
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ user_id: assignedTo, reason: 'no_response' });
    expect(ledger[0]!['reassigned_at']).toBeTruthy();
    // Escalation ends the ladder — no fresh timer (D-046 #3).
    expect(armed).toHaveLength(0);
  });

  it('with a second agent, the lead changes hands as a RE-assignment and the timer restarts', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // A colleague joins — account first (CR-14: memberships key to sign-in
    // identities), then the roster route, as ever.
    await app!.inject({
      method: 'POST', url: '/api/auth/sign-up/email',
      payload: { email: `f42t-b-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Beatrice Backup' },
    });
    const added = await app!.inject({
      method: 'POST', url: '/api/v1/members', headers: { cookie },
      payload: {
        organization_id: orgId, email: `f42t-b-${run}@dealpilot.test`, name: 'Beatrice Backup',
        roles: ['salesperson'],
      },
    });
    expect(added.statusCode, added.body).toBe(201);
    const colleague = (JSON.parse(added.body) as { user_id: string }).user_id;

    const { leadId, assignedTo: firstHolder } = await assignedLead();
    // Least-loaded decides the FIRST holder (likely the fresh colleague);
    // what matters here is the hand-off: away from the silent one, to the
    // other real member, never back.
    const { result, armed } = await fire(job(leadId, firstHolder));
    expect(result).toMatchObject({ outcome: 'reassigned', attempt: 1 });
    const to = (result as { to: string }).to;
    expect(to).not.toBe(firstHolder);
    expect([ownerId, colleague]).toContain(to);

    const row = await leadRow(leadId);
    expect(row['assignment_method']).toBe('reassignment');
    expect(row['assigned_to']).toBe(to);
    // The timer restarts on the NEW holder with the NEW attempt count.
    expect(armed).toEqual([{ organization_id: orgId, lead_id: leadId, assigned_to: to, attempt: 1 }]);

    // History tells the whole story, newest first.
    const hist = await admin.query<{ rule_name: string }>(
      `SELECT rule_name FROM lead_assignment_history WHERE lead_id = $1 ORDER BY assigned_at`,
      [leadId],
    );
    expect(hist.rows.map((h) => h.rule_name).at(-1)).toBe('funnel: reassignment');
  });

  it('the third strike goes straight to the manager and the ladder ENDS', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const { leadId, assignedTo } = await assignedLead();
    // Simulate a lead already on its final rung.
    await admin.query(`UPDATE leads SET assignment_attempts = 2 WHERE id = $1`, [leadId]);
    const { result, armed } = await fire(job(leadId, assignedTo, 2));
    expect(result).toMatchObject({ outcome: 'escalated', attempt: 3 });
    const row = await leadRow(leadId);
    expect(row['assignment_method']).toBe('escalation');
    expect(row['assignment_attempts']).toBe(3);
    expect(armed).toHaveLength(0);
    const hist = await admin.query<{ rule_name: string }>(
      `SELECT rule_name FROM lead_assignment_history WHERE lead_id = $1 ORDER BY assigned_at`,
      [leadId],
    );
    expect(hist.rows.map((h) => h.rule_name).at(-1)).toBe('escalation: three_strikes');
  });
});
