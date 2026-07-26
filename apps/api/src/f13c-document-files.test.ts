import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import { DealDocumentsResponse } from '@dealpilot/schemas';
import { buildApp } from './app.js';
import { sha256, type StorageDriver, type StoredObject } from './storage.js';

/**
 * F-13c document files.
 *
 * F-13 made the file's PREPARATION verifiable. This is about the FILE: until
 * now `status = 'signed'` was a person asserting a signature exists somewhere
 * off-system. With the bytes stored and their SHA-256 on record, and the hash
 * rechecked on every read, that claim becomes checkable.
 *
 * The test that matters most is the tamper case. Everything else here is
 * plumbing; that one is the reason the column exists.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');
const run = Date.now().toString(36);

/** In-memory driver: the routes are the subject, not the filesystem. */
class MemoryStorage implements StorageDriver {
  readonly kind = 'local' as const;
  readonly objects = new Map<string, Buffer>();
  async put(key: string, body: Buffer): Promise<StoredObject> {
    this.objects.set(key, body);
    return { key, sha256: sha256(body), bytes: body.byteLength };
  }
  async get(key: string): Promise<Buffer> {
    const found = this.objects.get(key);
    if (!found) throw new Error(`no object at ${key}`);
    return found;
  }
}

const storage = new MemoryStorage();
const PDF = Buffer.from('%PDF-1.7\nthe signed bank contract\n%%EOF\n');

let admin: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
let cookie = '';
let orgId = '';
let storeId = '';

async function makeDeal(extra: Record<string, unknown> = {}) {
  const res = await app!.inject({
    method: 'POST', url: '/api/v1/deals', headers: { cookie },
    payload: {
      organization_id: orgId, store_id: storeId, province: 'QC',
      sale_price_cents: 3_000_000, vehicle_cost_cents: 2_700_000,
      interest_rate_bps: 599, term_months: 60, ...extra,
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return (JSON.parse(res.body) as { id: string }).id;
}

async function documents(dealId: string) {
  const res = await app!.inject({
    method: 'GET', url: `/api/v1/deals/${dealId}/documents`, headers: { cookie },
  });
  expect(res.statusCode, res.body).toBe(200);
  return DealDocumentsResponse.parse(JSON.parse(res.body));
}

async function upload(documentId: string, body: Buffer, contentType = 'application/pdf') {
  return app!.inject({
    method: 'POST', url: `/api/v1/documents/${documentId}/file`,
    headers: { cookie, 'content-type': contentType },
    payload: body,
  });
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
  ({ app } = await buildApp({ DATABASE_URL: APP_URL, NODE_ENV: 'test' }, { storage }));

  const signUp = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: `f13c-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Alice Owner' },
  });
  const sc = signUp.headers['set-cookie'];
  cookie = (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');

  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe F13c', slug: `groupe-f13c-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'F13c Kia', code: 'F13C-KIA', province: 'QC' },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('a stored document is verifiable, not asserted', () => {
  it('stores the bytes with their hash and gives them back', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dealId = await makeDeal();
    const doc = (await documents(dealId)).items[0]!;

    const res = await upload(doc.id, PDF);
    expect(res.statusCode, res.body).toBe(201);
    const stored = JSON.parse(res.body) as {
      content_sha256: string; size_bytes: number; storage_key: string; content_type: string;
    };
    expect(stored.content_sha256).toBe(sha256(PDF));
    expect(stored.size_bytes).toBe(PDF.byteLength);
    expect(stored.content_type).toBe('application/pdf');
    // Per-tenant prefix: an S3 bucket policy cannot separate tenants without it.
    expect(stored.storage_key.startsWith(`org/${orgId}/`)).toBe(true);

    const back = await app!.inject({
      method: 'GET', url: `/api/v1/documents/${doc.id}/file`, headers: { cookie },
    });
    expect(back.statusCode).toBe(200);
    expect(back.headers['content-type']).toContain('application/pdf');
    expect(Buffer.from(back.rawPayload).equals(PDF)).toBe(true);
  });

  it('REFUSES to serve a file that no longer matches its recorded hash', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // The reason the hash column exists. If the bytes changed after upload, the
    // file is not the one anyone signed — and answering 200 with it would
    // launder an altered document into evidence.
    const dealId = await makeDeal();
    const doc = (await documents(dealId)).items[0]!;
    const res = await upload(doc.id, PDF);
    const key = (JSON.parse(res.body) as { storage_key: string }).storage_key;

    storage.objects.set(key, Buffer.from('%PDF-1.7\nsomething else entirely\n%%EOF\n'));

    const back = await app!.inject({
      method: 'GET', url: `/api/v1/documents/${doc.id}/file`, headers: { cookie },
    });
    expect(back.statusCode).toBe(409);
    expect(JSON.parse(back.body)).toMatchObject({ error: { code: 'content_mismatch' } });
  });

  it('re-uploading the identical file is idempotent; a different one lands beside it', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dealId = await makeDeal();
    const doc = (await documents(dealId)).items[0]!;
    const first = JSON.parse((await upload(doc.id, PDF)).body) as { storage_key: string };
    const same = JSON.parse((await upload(doc.id, PDF)).body) as { storage_key: string };
    expect(same.storage_key).toBe(first.storage_key);

    const corrected = Buffer.from('%PDF-1.7\nthe corrected scan\n%%EOF\n');
    const second = JSON.parse((await upload(doc.id, corrected)).body) as { storage_key: string };
    expect(second.storage_key).not.toBe(first.storage_key);
    // The original is still there: a corrected scan must not erase the evidence
    // of what was filed before it.
    expect(storage.objects.has(first.storage_key)).toBe(true);
  });

  it("reports whether the deal's file is verified, without gating on it", async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dealId = await makeDeal();
    const before = await documents(dealId);
    expect(before.wet_ink_verified).toBe(false);

    for (const d of before.items.filter((x) => x.requires_signature)) {
      expect((await upload(d.id, PDF)).statusCode).toBe(201);
    }
    const after = await documents(dealId);
    expect(after.wet_ink_verified).toBe(true);
    // Reported, not enforced — requiring a scan before filing is a workflow
    // change for every store, and that is the owner's call (D-039).
    expect(after.wet_ink_prepared).toBe(false);
  });

  it('the hash is in the activity trail, not only in the row', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dealId = await makeDeal();
    const doc = (await documents(dealId)).items[0]!;
    await upload(doc.id, PDF);

    const trail = await app!.inject({
      method: 'GET', url: `/api/v1/activity?entity_id=${dealId}`, headers: { cookie },
    });
    const events = (JSON.parse(trail.body) as { items: { changes: Record<string, unknown> }[] }).items;
    const uploaded = events.find((e) => 'content_sha256' in (e.changes ?? {}));
    expect(uploaded, 'an upload with nothing in the trail').toBeDefined();
    expect((uploaded!.changes['content_sha256'] as { to: string }).to).toBe(sha256(PDF));
  });
});

describe('what the upload refuses', () => {
  it('a type nobody scans a contract as', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dealId = await makeDeal();
    const doc = (await documents(dealId)).items[0]!;
    const res = await upload(doc.id, Buffer.from('<script>alert(1)</script>'), 'text/html');
    expect(res.statusCode).toBe(415);
  });

  it('an empty body — a 201 for zero bytes is a file that is not there', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dealId = await makeDeal();
    const doc = (await documents(dealId)).items[0]!;
    const res = await upload(doc.id, Buffer.alloc(0));
    expect(res.statusCode).toBe(422);
  });

  it("another organisation's document, as a 404", async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dealId = await makeDeal();
    const doc = (await documents(dealId)).items[0]!;
    const outsider = await app!.inject({
      method: 'POST', url: '/api/auth/sign-up/email',
      payload: { email: `f13c-out-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Bob' },
    });
    const osc = outsider.headers['set-cookie'];
    const outCookie = (Array.isArray(osc) ? osc : [osc!]).map((c) => c!.split(';')[0]).join('; ');

    const up = await app!.inject({
      method: 'POST', url: `/api/v1/documents/${doc.id}/file`,
      headers: { cookie: outCookie, 'content-type': 'application/pdf' }, payload: PDF,
    });
    expect(up.statusCode).toBe(404);
    const down = await app!.inject({
      method: 'GET', url: `/api/v1/documents/${doc.id}/file`, headers: { cookie: outCookie },
    });
    expect(down.statusCode).toBe(404);
  });

  it('a document with no file at all is a 404, not an empty 200', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dealId = await makeDeal();
    const doc = (await documents(dealId)).items[0]!;
    const res = await app!.inject({
      method: 'GET', url: `/api/v1/documents/${doc.id}/file`, headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('marking a stack of documents at once', () => {
  it('moves them all in one transaction', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dealId = await makeDeal();
    const items = (await documents(dealId)).items;
    const ids = items.map((d) => d.id);

    const gen = await app!.inject({
      method: 'POST', url: `/api/v1/deals/${dealId}/documents/batch`, headers: { cookie },
      payload: { document_ids: ids, status: 'generated' },
    });
    expect(gen.statusCode, gen.body).toBe(200);
    expect((await documents(dealId)).items.every((d) => d.status === 'generated')).toBe(true);
  });

  it('refuses the whole stack if one document cannot make the move', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // All-or-nothing on purpose: a half-marked file is exactly what the
    // dispatch gate would then read as ready.
    const dealId = await makeDeal();
    const items = (await documents(dealId)).items;
    const ids = items.map((d) => d.id);
    await app!.inject({
      method: 'POST', url: `/api/v1/deals/${dealId}/documents/batch`, headers: { cookie },
      payload: { document_ids: ids, status: 'generated' },
    });

    // `filed` is not reachable from `generated` for a signature document.
    const res = await app!.inject({
      method: 'POST', url: `/api/v1/deals/${dealId}/documents/batch`, headers: { cookie },
      payload: { document_ids: ids, status: 'filed' },
    });
    expect(res.statusCode).toBe(422);
    expect((await documents(dealId)).items.every((d) => d.status === 'generated')).toBe(true);
  });

  it("refuses a stack containing another deal's document", async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dealA = await makeDeal();
    const dealB = await makeDeal();
    const a = (await documents(dealA)).items.map((d) => d.id);
    const b = (await documents(dealB)).items[0]!.id;
    const res = await app!.inject({
      method: 'POST', url: `/api/v1/deals/${dealA}/documents/batch`, headers: { cookie },
      payload: { document_ids: [...a, b], status: 'generated' },
    });
    // Silently skipping it would leave the clerk believing they filed it.
    expect(res.statusCode).toBe(404);
  });
});
