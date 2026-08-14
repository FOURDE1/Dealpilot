import { expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { roomName } from '@dealpilot/contracts';

/**
 * Realtime vocabulary guard (ADR-004).
 *
 * ADR-004 removes the database from the realtime read path: "realtime
 * authorization is enforced at join/emit time by application code — RLS no
 * longer implicitly filters the stream". Every other leak this codebase has
 * had was caught by a tenant policy on the way out. A wrong room name is not.
 *
 * So there is exactly one function that may produce a room string, and this
 * fails the build the moment a second one appears — a hand-built
 * `` `tenant:${orgId}:...` `` in a route, or a raw `io.to('...')` that skips
 * the descriptor and its uuid checks.
 *
 * The mistake this prevents is not exotic. It is one template literal, written
 * by somebody in a hurry, with `storeId` where `organizationId` belongs.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');

/** The one file allowed to say `tenant:` — the builder itself. */
const ROOM_BUILDER = join('packages', 'contracts', 'src', 'realtime.ts');

/**
 * Comments out before anything reads code out of prose.
 *
 * Second time: the enum-vocabulary guard's first run reported 'pending' as a
 * forbidden value because the word appeared inside a comment explaining why it
 * was removed, and this one's first run reported the room builder itself
 * because its doc comment says "a raw `io.to('some string')`". A guard that
 * reads prose as code manufactures findings, and a manufactured finding is
 * worse than a missed one — it teaches the reader to skim the output.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Not `://`, so a URL in a string survives.
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const SCANNED = ['apps/api/src', 'apps/web/src', 'packages/contracts/src', 'packages/core/src']
  .map((p) => join(repo, ...p.split('/')))
  .flatMap((d) => sourceFiles(d));

it('found the sources to scan', () => {
  // A path change that silently emptied this list would make every assertion
  // below pass while checking nothing.
  expect(SCANNED.length).toBeGreaterThan(50);
});

it('only the builder writes a room name', () => {
  const offenders: string[] = [];
  for (const file of SCANNED) {
    const rel = relative(repo, file);
    if (rel === ROOM_BUILDER) continue;
    // A test may ASSERT the shape of a name — that is the point of a test — so
    // only non-test sources are held to this.
    if (/\.test\.tsx?$/.test(rel)) continue;
    const text = stripComments(readFileSync(file, 'utf8'));
    if (/['"`]tenant:/.test(text)) offenders.push(rel);
  }
  expect(
    offenders,
    `these files build a realtime room name by hand instead of calling roomName() — one transposed id here sends a dealership's conversations to a rival, and no RLS policy is watching: ${offenders.join(', ')}`,
  ).toEqual([]);
});

it('nothing reaches past the Emitter to a raw socket', () => {
  const offenders: string[] = [];
  for (const file of SCANNED) {
    const rel = relative(repo, file);
    if (/\.test\.tsx?$/.test(rel)) continue;
    // realtime.ts is where the Emitter is implemented; it is the one place a
    // Socket.IO server is legitimately in scope.
    if (rel === join('apps', 'api', 'src', 'realtime.ts')) continue;
    const text = stripComments(readFileSync(file, 'utf8'));
    if (/\bio\s*\.\s*to\s*\(|\bio\s*\.\s*emit\s*\(/.test(text)) offenders.push(rel);
  }
  expect(
    offenders,
    `these files emit through a Socket.IO server directly, bypassing the Emitter interface and the room builder with it: ${offenders.join(', ')}`,
  ).toEqual([]);
});

it('refuses to build a room name from anything but a uuid', () => {
  const org = '11111111-1111-4111-8111-111111111111';
  const conv = '22222222-2222-4222-8222-222222222222';
  expect(roomName({ kind: 'conversation', organizationId: org, conversationId: conv }))
    .toBe(`tenant:${org}:conversation:${conv}`);

  // The shapes an attacker would reach for. Each one, unchecked, widens or
  // redirects a subscription; each one throws instead.
  for (const evil of ['*', '', 'tenant:*', `${org}:conversation:*`, '../..', 'null']) {
    expect(
      () => roomName({ kind: 'conversation', organizationId: evil, conversationId: conv }),
      evil,
    ).toThrow(/must be a uuid/);
    expect(
      () => roomName({ kind: 'conversation', organizationId: org, conversationId: evil }),
      evil,
    ).toThrow(/must be a uuid/);
  }
});

it('gives every room kind a distinct name', () => {
  const org = '11111111-1111-4111-8111-111111111111';
  const other = '33333333-3333-4333-8333-333333333333';
  const names = [
    roomName({ kind: 'deals', organizationId: org, storeId: other }),
    roomName({ kind: 'leads', organizationId: org, storeId: other }),
    roomName({ kind: 'notifications', organizationId: org, userId: other }),
    roomName({ kind: 'presence', organizationId: org }),
    roomName({ kind: 'conversation', organizationId: org, conversationId: other }),
  ];
  // A collision would deliver one room's events to another's subscribers —
  // deals to the leads queue, or worse, a conversation to a store-wide room.
  expect(new Set(names).size).toBe(names.length);
  // §13: "Room names are always prefixed `tenant:{tenantId}:`".
  expect(names.every((n) => n.startsWith(`tenant:${org}:`))).toBe(true);
});
