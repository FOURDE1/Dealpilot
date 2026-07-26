import { expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { apiV1 } from '@dealpilot/contracts';

/**
 * Every endpoint the contract promises is exercised by at least one test.
 *
 * `contract-coverage.test.ts` already proves the routes and the contract agree
 * with each other. That is a different question from whether anybody has ever
 * called them: a route can be registered, typed, documented and completely
 * unexercised, and the first person to find out is whoever tries to use it.
 *
 * Both cross-agent CRs this week came from exactly there. CR-15's dark-mode
 * foreground was published by a route with a passing test that only checked the
 * light half; the org-less 404 was a code path no test had ever taken. Neither
 * was a hard bug to see once someone looked — nobody had looked.
 *
 * Coarse on purpose: it asks whether the path appears in a test at all, not
 * whether the test is any good. That is the cheapest question that would have
 * caught both.
 */

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Endpoints with no direct test, and why that is acceptable TODAY. Each line is
 * a debt someone chose, not an oversight — which is the only difference between
 * this list and the gap it exists to prevent.
 */
const UNTESTED_BY_DESIGN: Record<string, string> = {};

/** Every `path:` string the contract declares, however deeply nested. */
function contractPaths(node: unknown, found: Set<string> = new Set()): Set<string> {
  if (!node || typeof node !== 'object') return found;
  const record = node as Record<string, unknown>;
  if (typeof record['path'] === 'string' && typeof record['method'] === 'string') {
    found.add(`${String(record['method'])} ${String(record['path'])}`);
    return found;
  }
  for (const value of Object.values(record)) contractPaths(value, found);
  return found;
}

function testSource(): string {
  return readdirSync(here)
    .filter((f) => f.endsWith('.test.ts'))
    .map((f) => readFileSync(join(here, f), 'utf8'))
    .join('\n');
}

it('every endpoint in the contract is called by at least one test', () => {
  const source = testSource();
  const untested: string[] = [];

  for (const entry of contractPaths(apiV1)) {
    if (entry in UNTESTED_BY_DESIGN) continue;
    const path = entry.split(' ')[1]!;
    // `/api/v1/deals/:id/documents` has to match `/api/v1/deals/${dealId}/documents`
    // in a template literal, so each parameter becomes a wildcard.
    const pattern = new RegExp(
      path
        .split('/')
        .map((seg) => (seg.startsWith(':') ? '[^/`\'"\\s]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
        .join('/'),
    );
    if (!pattern.test(source)) untested.push(entry);
  }

  expect(
    untested,
    `these endpoints are declared, registered and never called by a test — the first person to find out what they do will be a user:\n${untested.join('\n')}`,
  ).toEqual([]);
});
