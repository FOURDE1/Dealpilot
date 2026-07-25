import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiV1 } from '@dealpilot/contracts';
import { ensureTestDatabase, testAppUrl } from '@dealpilot/db';
import { buildApp } from './app.js';

/**
 * CONTRACT COVERAGE GUARD (CR-03, filed by HUSSEIN 2026-07-26).
 *
 * The F-08 endpoints shipped as Fastify routes with no entry in `apiV1`, so
 * the typed client and the OpenAPI document did not know they existed and the
 * web app had to carry hand-written route literals. Nothing caught it — the
 * contract and the server were only ever compared by eye.
 *
 * This compares them in both directions:
 *   - a route with no contract entry is invisible to every client;
 *   - a contract entry with no route is a promise the server does not keep,
 *     and the typed client will happily call it and 404.
 */

let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;

/**
 * Fastify prints a radix tree: a child line holds only the SUFFIX its parent
 * did not already spell out (`/api/v1/me` then `mbers` = `/api/v1/members`).
 * Rebuild full paths by keeping one prefix per depth.
 */
function routesFromTree(tree: string): Set<string> {
  const out = new Set<string>();
  const prefixAtDepth: string[] = [];
  for (const line of tree.split('\n')) {
    const m = /^([\s│]*)(?:[├└]── )?(\S*)\s*(?:\(([^)]*)\))?\s*$/.exec(line);
    if (!m) continue;
    const depth = Math.floor(m[1]!.length / 4);
    const segment = m[2] ?? '';
    if (segment === '') continue;
    const prefix = depth === 0 ? '' : (prefixAtDepth[depth - 1] ?? '');
    const full = prefix + segment;
    prefixAtDepth[depth] = full;
    prefixAtDepth.length = depth + 1;
    const methods = (m[3] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && s !== 'HEAD' && s !== 'OPTIONS');
    for (const method of methods) out.add(`${method} ${full}`);
  }
  return out;
}

/** Walk the nested ts-rest routers and collect every declared endpoint. */
function routesFromContract(node: unknown, acc = new Set<string>()): Set<string> {
  if (!node || typeof node !== 'object') return acc;
  const r = node as Record<string, unknown>;
  if (typeof r['method'] === 'string' && typeof r['path'] === 'string') {
    acc.add(`${r['method'] as string} ${r['path'] as string}`);
    return acc;
  }
  for (const v of Object.values(r)) routesFromContract(v, acc);
  return acc;
}

/**
 * Endpoints deliberately outside the typed contract, each with a reason.
 * Anything not listed here has to be in `apiV1`.
 */
const NOT_IN_CONTRACT: Record<string, string> = {
  'GET /api/v1/health': 'Liveness probe for the load balancer — not part of the product API.',
  'POST /api/v1/intake/:key': 'F-03 public intake: called by third-party lead providers, not by our client. Its shape is owned by the intake spec, not by apiV1.',
};

beforeAll(async () => {
  await ensureTestDatabase();
  try {
    ({ app } = await buildApp({ DATABASE_URL: testAppUrl(), NODE_ENV: 'test' }));
    await app.ready();
    dbUp = true;
  } catch {
    if (process.env['RLS_REQUIRED']) throw new Error('RLS_REQUIRED set but the app would not build');
  }
});

afterAll(async () => {
  await app?.close();
});

describe('the server and the typed contract describe the same API', () => {
  it('parsed a plausible number of routes from both sides', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Guards the guard: a printRoutes format change that broke the parser would
    // otherwise make every assertion below vacuously pass.
    const served = routesFromTree(app!.printRoutes({ commonPrefix: false }));
    expect(served.size).toBeGreaterThan(20);
    expect(routesFromContract(apiV1).size).toBeGreaterThan(20);
  });

  it('every served /api/v1 route is in the contract (CR-03)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const contract = routesFromContract(apiV1);
    const served = [...routesFromTree(app!.printRoutes({ commonPrefix: false }))]
      .filter((r) => / \/api\/v1\//.test(r))
      .filter((r) => !(r in NOT_IN_CONTRACT));
    const undeclared = served.filter((r) => !contract.has(r));
    expect(
      undeclared,
      `served but absent from apiV1, so no typed client or OpenAPI reader can see them: ${undeclared.join(', ')}`,
    ).toEqual([]);
  });

  it('every contract route is actually served', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const served = routesFromTree(app!.printRoutes({ commonPrefix: false }));
    const missing = [...routesFromContract(apiV1)].filter((r) => !served.has(r));
    expect(
      missing,
      `promised by apiV1 but not mounted — a typed client would call these and get a 404: ${missing.join(', ')}`,
    ).toEqual([]);
  });
});
