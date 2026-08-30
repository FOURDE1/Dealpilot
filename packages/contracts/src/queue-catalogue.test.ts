import { describe, expect, it } from 'vitest';
import * as contracts from './index.js';
import * as queues from './queues.js';
import {
  JOB_QUEUES,
  JOB_QUEUE_NAMES,
  QUEUE_PAYLOAD,
  QUEUES_WITHOUT_PAYLOAD,
  queueIsOrgScoped,
  type QueueNameT,
} from './queues.js';

/**
 * F-73 §9 — the catalogue the platform console reads, held to its own claims.
 *
 * Three of those claims are load-bearing and none of them has a compiler
 * behind it:
 *
 *   1. The catalogue names EVERY queue. A queue this file has never heard of
 *      is a queue the job inspector cannot show, and nothing else in the repo
 *      would notice — the names are ten unrelated string constants.
 *   2. Each queue is paired with ITS payload. The pairing decides which keys
 *      the DLQ page projects, so a queue paired to the wrong schema shows the
 *      wrong fields, and a queue with no pairing shows nothing while looking
 *      healthy.
 *   3. `dlq_fields` never reaches a free-form string. `DeferredSendJob.body`
 *      is up to 1600 characters of a real dealer customer's SMS, carried on
 *      the queue because it cannot be re-derived. The allow-list is what keeps
 *      it off a support person's screen, and an allow-list is only as good as
 *      the check that it lists identifiers.
 *
 * Written BEFORE the console that consumes it, deliberately: a catalogue is
 * exactly the kind of declaration this repo keeps shipping with no reader.
 */

/** Zod 4 keeps the node kind on `.def.type`; there is no stable class to test. */
interface ZodNode {
  readonly def: { readonly type: string; readonly format?: string; readonly innerType?: ZodNode };
}
interface ZodObjectNode extends ZodNode {
  readonly shape: Record<string, ZodNode>;
}

function isZodObject(v: unknown): v is ZodObjectNode {
  return (
    typeof v === 'object' &&
    v !== null &&
    'def' in v &&
    (v as ZodNode).def.type === 'object' &&
    'shape' in v
  );
}

/**
 * Peel `optional` / `default` / `nullable` off a field until the leaf.
 *
 * Four allow-listed fields are wrapped — `attempt` carries `.default(0)` on
 * three payloads and `duplicate_of` is `.optional()` — so a check that reads
 * `def.type` without unwrapping would reject legal identifiers, and one that
 * only looked for a wrapper would admit `body`.
 */
function leafOf(node: ZodNode): { type: string; format: string | undefined } {
  const WRAPPERS = new Set(['optional', 'default', 'nullable']);
  let cursor = node;
  // Bounded: a cyclic schema would otherwise hang the suite rather than fail it.
  for (let depth = 0; depth < 8 && WRAPPERS.has(cursor.def.type) && cursor.def.innerType; depth += 1) {
    cursor = cursor.def.innerType;
  }
  return { type: cursor.def.type, format: cursor.def.format };
}

describe('the queue catalogue names every queue (F-73 §9)', () => {
  /**
   * `typeof v === 'string'` is not optional, and it is copied from the guard
   * that already does this in apps/workers/src/queue-naming.test.ts:55.
   * Without it this comparison would include the catalogue's own exports —
   * QUEUE_PAYLOAD and QUEUE_WORKER_FILE are objects whose export names also
   * start with QUEUE_ — and the guard would fail on the day it was written,
   * for a reason that has nothing to do with queues.
   */
  const declaredNames = Object.entries(contracts)
    .filter(([k, v]) => k.startsWith('QUEUE_') && k !== 'QUEUE_PREFIX' && typeof v === 'string')
    .map(([, v]) => v as string)
    .sort();

  it('every QUEUE_* name constant is in JOB_QUEUES, and nothing else is', () => {
    // A rename of the export prefix would empty the list and quietly stop
    // checking anything at all.
    expect(declaredNames.length, 'the QUEUE_* catalogue came back near-empty').toBeGreaterThan(8);
    expect(Object.keys(JOB_QUEUES).sort()).toEqual(declaredNames);
    expect(JOB_QUEUE_NAMES.slice().sort()).toEqual(declaredNames);
  });
});

describe('every payload is claimed by exactly one queue', () => {
  const exportedJobs = Object.entries(queues).filter(([k, v]) => k.endsWith('Job') && isZodObject(v)) as [
    string,
    ZodObjectNode,
  ][];

  it('finds the payload schemas at all', () => {
    // If the naming convention changes, this guard must go red rather than
    // silently start asserting nothing.
    expect(exportedJobs.map(([k]) => k).sort()).toEqual([
      'AiExtractionJob',
      'AnnouncementFanoutJob',
      'AssistantTurnJob',
      'DeferredSendJob',
      'FirstTouchJob',
      'LeadReassignJob',
      'LiveAnalysisJob',
    ]);
  });

  it('claims each exported *Job schema once — no orphan, no double-booking', () => {
    for (const [exportName, schema] of exportedJobs) {
      const owners = JOB_QUEUE_NAMES.filter((q) => (QUEUE_PAYLOAD[q] as unknown) === (schema as unknown));
      expect(
        owners,
        `${exportName} is claimed by ${owners.length} queues (${owners.join(', ') || 'none'}). ` +
          'A payload with no queue is a job the console cannot read; a payload with two is a projection that shows one queue the other queue\'s fields.',
      ).toHaveLength(1);
    }
    const claimed = JOB_QUEUE_NAMES.map((q) => QUEUE_PAYLOAD[q]).filter((p) => p !== null);
    expect(claimed.length, 'a queue is paired with a schema this file does not export').toBe(exportedJobs.length);
  });

  it('excuses a queue with no payload by name, with a reason', () => {
    const unpaired = JOB_QUEUE_NAMES.filter((q) => QUEUE_PAYLOAD[q] === null).sort();
    expect(Object.keys(QUEUES_WITHOUT_PAYLOAD).sort()).toEqual(unpaired);
    for (const q of unpaired) {
      expect((QUEUES_WITHOUT_PAYLOAD[q] ?? '').trim().length, `${q} carries no payload and no reason`).toBeGreaterThan(20);
    }
  });
});

describe('org_scoped is derived from the payload, never hand-typed', () => {
  /**
   * The partition, written HERE rather than in the product: the catalogue
   * derives `org_scoped` and therefore cannot disagree with itself, so the
   * only assertion worth making is against an independent expectation. If a
   * payload gains or loses `organization_id`, this goes red and somebody
   * decides whether the DLQ's tenant filter should follow — instead of the
   * console silently starting or stopping to offer it.
   */
  const ORG_SCOPED: QueueNameT[] = [
    'deferred-send',
    'assistant-turn',
    'lead-reassign',
    'ai-extraction',
    'first-touch',
    'live-analysis',
  ];
  /**
   * Four, not five. `announcement-fanout` deliberately carries no tenant (an
   * announcement belongs to none); the other three carry no payload at all.
   * For these the API REFUSES an `?organization_id=` filter with a 422 rather
   * than returning an empty page, which would read as "this tenant has no
   * failures" and be a lie by construction.
   */
  const NOT_ORG_SCOPED: QueueNameT[] = ['announcement-fanout', 'drip-tick', 'qa-review', 'task-sweep'];

  it('splits the ten the way the payloads do', () => {
    expect([...ORG_SCOPED, ...NOT_ORG_SCOPED].sort()).toEqual(JOB_QUEUE_NAMES.slice().sort());
    for (const q of JOB_QUEUE_NAMES) {
      const payload = QUEUE_PAYLOAD[q];
      const derived = payload !== null && 'organization_id' in payload.shape;
      expect(queueIsOrgScoped(q), `${q}: the catalogue's own derivation`).toBe(derived);
      expect(JOB_QUEUES[q].org_scoped, `${q}: JOB_QUEUES disagrees with its payload`).toBe(derived);
      expect(derived, `${q} moved across the org-scoping line — review the DLQ filter`).toBe(ORG_SCOPED.includes(q));
    }
  });
});

describe('dlq_fields is an allow-list of identifiers, and only identifiers', () => {
  it('lists only keys the payload actually has', () => {
    for (const q of JOB_QUEUE_NAMES) {
      const payload = QUEUE_PAYLOAD[q];
      if (payload === null) {
        expect(JOB_QUEUES[q].dlq_fields, `${q} has no payload, so it can project no fields`).toEqual([]);
        continue;
      }
      for (const key of JOB_QUEUES[q].dlq_fields) {
        expect(Object.keys(payload.shape), `${q}.dlq_fields names '${key}', which its payload does not carry`).toContain(key);
      }
    }
  });

  it('never lists a bare string — a uuid, a number or an enum, nothing else', () => {
    let checked = 0;
    for (const q of JOB_QUEUE_NAMES) {
      const payload = QUEUE_PAYLOAD[q];
      if (payload === null) continue;
      // Indexed through a widened view: each payload's shape is its own literal
      // type, and the allow-list is a string list by design.
      const shape = payload.shape as Record<string, ZodNode | undefined>;
      for (const key of JOB_QUEUES[q].dlq_fields) {
        const leaf = leafOf(shape[key]!);
        checked += 1;
        const ok = leaf.type === 'number' || leaf.type === 'enum' || (leaf.type === 'string' && leaf.format === 'uuid');
        expect(
          ok,
          `${q}.dlq_fields lists '${key}', which resolves to ${leaf.type}${leaf.format ? `/${leaf.format}` : ''}. ` +
            (leaf.type === 'string' && leaf.format === undefined
              ? 'That is a bare ZodString — free-form text a customer may have written. The DLQ shows identifiers.'
              : 'Only a uuid, a number or an enum may be projected onto the console.'),
        ).toBe(true);
      }
    }
    // A refactor that emptied the allow-lists would pass every assertion above.
    expect(checked, 'no dlq_fields were type-checked — this guard is looking at nothing').toBeGreaterThan(15);
  });

  it("refuses 'body' by name, and refuses tenant_id anywhere", () => {
    const everyField = JOB_QUEUE_NAMES.flatMap((q) => JOB_QUEUES[q].dlq_fields);
    expect(
      everyField,
      "'body' is the deferred-send payload's copy of a real customer's SMS. It is carried because it cannot be re-derived, and it is never shown.",
    ).not.toContain('body');

    // §9 says `tenant_id`; this repo has never had that column, and
    // packages/schemas is the vocabulary truth. The scoping field is
    // `organization_id`, everywhere, and a payload that spelled it the spec's
    // way would silently never be org-scoped.
    expect(everyField).not.toContain('tenant_id');
    for (const q of JOB_QUEUE_NAMES) {
      const payload = QUEUE_PAYLOAD[q];
      if (payload === null) continue;
      expect(Object.keys(payload.shape), `${q}'s payload spells the tenant key the spec's way`).not.toContain('tenant_id');
    }
  });
});
