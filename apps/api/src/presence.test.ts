import { describe, expect, it } from 'vitest';
import { inMemoryPresenceStore, PRESENCE_TTL_MS } from './presence.js';

/**
 * F-43 — presence semantics, golden (D-047). The Redis store mirrors these
 * exact semantics and is exercised end-to-end by the realtime suites; what is
 * pinned HERE is the tri-state contract the cascade depends on.
 */
describe('presence tri-state (D-047 #2)', () => {
  it('an org that never produced data reads NULL — the filter must know it knows nothing', async () => {
    const store = inMemoryPresenceStore();
    expect(await store.onlineIn('org-a')).toBeNull();
  });

  it('a touched org reads a real set, and other orgs still read NULL', async () => {
    const store = inMemoryPresenceStore();
    await store.touch('org-a', 'u1');
    expect(await store.onlineIn('org-a')).toEqual(new Set(['u1']));
    expect(await store.onlineIn('org-b')).toBeNull();
  });

  it('marks age out after the 3-minute window — but the org keeps READING as known', async () => {
    let now = 1_000_000;
    const store = inMemoryPresenceStore(() => now);
    await store.touch('org-a', 'u1');
    now += PRESENCE_TTL_MS - 1;
    expect(await store.onlineIn('org-a')).toEqual(new Set(['u1']));
    now += 2; // past the window
    // EMPTY, not null: "genuinely nobody online" escalates; "no data" skips.
    expect(await store.onlineIn('org-a')).toEqual(new Set());
  });

  it('a refresh keeps a member alive across windows', async () => {
    let now = 0;
    const store = inMemoryPresenceStore(() => now);
    await store.touch('org-a', 'u1');
    now += PRESENCE_TTL_MS - 1000;
    await store.touch('org-a', 'u1'); // the 60s beat
    now += PRESENCE_TTL_MS - 1000;
    expect(await store.onlineIn('org-a')).toEqual(new Set(['u1']));
  });
});
