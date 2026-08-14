import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Queue } from 'bullmq';
import { QUEUE_ASSISTANT_TURN, QUEUE_DEFERRED_SEND, QUEUE_PREFIX, queueOpts } from '@dealpilot/contracts';

/**
 * The queue names have to be names BullMQ accepts, and both sides have to
 * namespace the same way.
 *
 * Both of those were wrong and neither was visible. The names were
 * `dealpilot:deferred-send` and `dealpilot:assistant-turn`; BullMQ rejects a
 * colon in a queue name because a colon is its own Redis key separator, and it
 * throws from the constructor. The API and the workers therefore both died on
 * startup — in every environment that had Redis, which is every deployed one.
 *
 * It survived that long because `createDeferredSendQueue` short-circuits to a
 * no-op when REDIS_URL is unset, and no local process sets it. The Queue was
 * never constructed. The CI e2e job, booting the API with Redis present for the
 * first time, is what finally ran the line.
 *
 * The last test guards the failure that would be WORSE than the crash. If one
 * side passes `prefix` and the other does not, both processes are healthy,
 * nothing throws, and the API writes jobs under `dealpilot:` while the worker
 * blocks on `bull:` — every deferred message waiting forever for a consumer
 * listening somewhere else. A crash announces itself; that does not.
 */

const here = dirname(fileURLToPath(import.meta.url));
const SRC_DIRS = [here, join(here, '..', '..', 'api', 'src')];

describe('the names BullMQ will accept', () => {
  it('rejects a colon — asked of the library, not of a copy of its rule', () => {
    // The exact string that shipped. Driven through the real constructor so
    // this cannot drift from what the installed BullMQ actually enforces; a
    // hand-written regex for ':' would keep passing if the rule changed.
    //
    // Nothing connects: the name is validated before any Redis client is built,
    // which is also why the good-name case is asserted separately below rather
    // than by constructing a live queue and leaving a socket behind.
    expect(
      () => new Queue('dealpilot:deferred-send', queueOpts({ host: '127.0.0.1', port: 6379 })),
    ).toThrow(/cannot contain :/);
  });

  it.each([
    ['deferred send', QUEUE_DEFERRED_SEND],
    ['assistant turn', QUEUE_ASSISTANT_TURN],
  ])('%s satisfies it', (_label, name) => {
    expect(
      name,
      `"${name}" contains a colon. BullMQ uses ':' as its Redis key separator and refuses the name outright — the API and the workers will both fail to boot. Namespacing goes in QUEUE_PREFIX, not the name.`,
    ).not.toContain(':');
    expect(name.length).toBeGreaterThan(0);
  });

  it('puts the namespace in the prefix instead', () => {
    expect(queueOpts({}).prefix).toBe(QUEUE_PREFIX);
    expect(QUEUE_PREFIX).not.toContain(':');
  });
});

describe('both sides namespace identically', () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      if (e.isDirectory()) return sourceFiles(join(dir, e.name));
      if (!e.name.endsWith('.ts') || e.name.endsWith('.test.ts')) return [];
      return [join(dir, e.name)];
    });
  }

  /**
   * The span of a `new Queue(...)` / `new Worker(...)` call, by balancing
   * parentheses from the opening one.
   *
   * A fixed lookahead of N lines was the first attempt and it was wrong: the
   * Worker in `index.ts` passes its options eighteen lines below the
   * constructor, after a long inline handler, so a short window reported a call
   * site that was in fact correct. A guard that cries wolf gets its threshold
   * raised until it stops catching anything.
   */
  function callSpan(src: string, from: number): string {
    const open = src.indexOf('(', from);
    if (open === -1) return '';
    let depth = 0;
    for (let i = open; i < src.length; i += 1) {
      if (src[i] === '(') depth += 1;
      else if (src[i] === ')') {
        depth -= 1;
        if (depth === 0) return src.slice(open, i + 1);
      }
    }
    return src.slice(open);
  }

  it('constructs every Queue and Worker through queueOpts', () => {
    const files = SRC_DIRS.flatMap(sourceFiles);
    // A path change that found nothing would make this pass while checking
    // nothing at all.
    expect(files.length).toBeGreaterThan(10);

    const offenders: string[] = [];
    let sitesSeen = 0;

    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const re = /\bnew (?:Queue|Worker)\s*(?:<[^>]*>)?\s*\(/g;
      for (const m of src.matchAll(re)) {
        sitesSeen += 1;
        if (callSpan(src, m.index).includes('queueOpts')) continue;
        const line = src.slice(0, m.index).split('\n').length;
        const short = file.replace(/\\/g, '/').split('/').slice(-3).join('/');
        offenders.push(`${short}:${line}`);
      }
    }

    // The API builds two queues and the workers a queue plus two workers. If
    // this ever reads zero, the regex stopped matching and the guard went quiet
    // rather than green.
    expect(sitesSeen, 'found no Queue/Worker construction at all — this guard is no longer looking at anything').toBeGreaterThanOrEqual(5);

    expect(
      offenders,
      `these construct a BullMQ Queue or Worker without queueOpts, so they get BullMQ's default "bull" prefix while everything else uses "${QUEUE_PREFIX}". Nothing throws: the producer and the consumer simply stop sharing a queue, and deferred messages wait forever for a worker listening on different keys. Wrap the connection in queueOpts():\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });
});
