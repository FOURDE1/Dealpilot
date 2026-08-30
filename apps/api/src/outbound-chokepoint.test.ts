import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * F-72 — the guarantee behind the kill switches, held as a shape rather than a
 * promise.
 *
 * `sms_send_killswitch` is only true if there is nowhere else for an outbound
 * message to leave from. Today that holds because the path is a funnel:
 * `sendMessage` is the only writer of an OUTBOUND `messages` row; it is the
 * only caller of `evaluateSend` that goes on to send; `deliverMessage` is the
 * only caller of `carrier.send`; and every `deliverMessage` runs downstream of
 * a `sendMessage` in the same tick. Two of those are enforced by the compiler
 * exactly nowhere.
 *
 * The two "only"s are narrowed on purpose, because the wider ones are false and
 * a guard that asserts a falsehood is worse than no guard. `recordInbound`
 * (f19-send.ts) writes the other kind of `messages` row — the customer's own
 * text, which no switch may drop — so the check below classifies each INSERT by
 * the direction it writes rather than by the file it lives in; per file it was
 * vacuous, since both writers share f19-send.ts. And `evaluateSend` has a
 * second caller in the F-15 compliance preview (f15-compliance-routes.ts),
 * which renders a decision and sends nothing; it is enumerated as a legitimate
 * `killSwitches()` reader at the bottom of this file.
 *
 * This guard is what keeps the totality argument true after the slice that
 * adds the redelivery worker, the campaign blaster, or the webhook replay.
 * None of them exists yet, which is the point: the day one does, this file is
 * the thing that fails and says what it must be wired through.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const SRC_DIRS = [join(repoRoot, 'apps', 'api', 'src'), join(repoRoot, 'apps', 'workers', 'src')];

/**
 * What counts as "the gate ran here". `sendMessage` is the gate's only caller;
 * `handOff` is a one-hop wrapper that stages the handoff notice through it, and
 * `runHandoffPhase` delivers what `handOff` staged, so the call it makes is
 * three lines away in the same tick rather than in the same function body.
 *
 * The hop is not taken on trust: each stager's own definition is opened below
 * and asserted to reach the next link. A wrapper that stopped staging through
 * `sendMessage` would fail here, not silently license its callers.
 */
const GATED_STAGERS = [
  { call: 'sendMessage(', file: 'apps/api/src/f19-send.ts', name: 'sendMessage', reaches: 'evaluateSend(' },
  { call: 'handOff(', file: 'apps/api/src/f20-handoff.ts', name: 'handOff', reaches: 'sendMessage(' },
];

/**
 * Every call site that can reach the carrier without THIS tick's
 * `evaluateSend`, registered with its reason so each is a decision on the
 * record rather than a hole nobody noticed. None is waved through: the check
 * below swaps the generic rule for the specific claim that keeps the site safe.
 *
 * `runFirstTouch` is here even though its body does contain a `sendMessage(`,
 * and that is the point. It reaches `deliverMessage` from THREE arms — a fresh
 * gated send, and two crash-recovery scans that re-deliver a prior message
 * whose carrier call never concluded. The generic rule would pass it on the
 * strength of the first arm while saying nothing about the other two, which is
 * a vacuous pass: what actually keeps those two safe is the f30-deliver belt.
 */
const EXEMPT_SITES = [
  {
    file: 'apps/workers/src/drip-tick.ts',
    fn: 'processEnrollment',
    reason:
      'crash-recovery redelivery — a staged drip whose carrier call never concluded (provider_ref NULL) is re-sent from the previous tick’s row, so the gate ran on the tick that staged it. Covered by the f30-deliver belt, not by evaluateSend.',
    /** The redelivery scan itself. If it goes, so does the reason to exempt. */
    evidence: 'provider_ref IS NULL',
  },
  {
    file: 'apps/workers/src/first-touch.ts',
    fn: 'runFirstTouch',
    reason:
      'two crash-recovery redeliveries — the greeting scan and the duplicate-confirm scan each re-deliver a prior message with provider_ref NULL, staged on an earlier run that DID pass the gate. The function’s third arm is a fresh gated send; these two are covered by the f30-deliver belt.',
    /** Both recovery arms branch on this. If they go, so does the reason. */
    evidence: 'provider_ref !== null',
  },
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return sourceFiles(join(dir, e.name));
    if (!e.name.endsWith('.ts') || e.name.endsWith('.test.ts') || e.name.endsWith('.d.ts')) return [];
    return [join(dir, e.name)];
  });
}

const files = sourceFiles(SRC_DIRS[0]!)
  .concat(sourceFiles(SRC_DIRS[1]!))
  .map((path) => ({ path, rel: relative(repoRoot, path).replace(/\\/g, '/'), src: readFileSync(path, 'utf8') }));

/** Files holding a literal, as repo-relative paths. */
function holders(literal: string): string[] {
  return files.filter((f) => f.src.includes(literal)).map((f) => f.rel).sort();
}

/**
 * The source with every comment and string body blanked to spaces — lengths and
 * newlines preserved, so offsets still line up with the original. Brace
 * matching has to see code only: a URL in a template literal reads as a line
 * comment otherwise, and a brace in a comment unbalances everything after it.
 */
function codeOnly(src: string): string {
  const token = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
  return src.replace(token, (m) => m.replace(/[^\n]/g, ' '));
}

/** Every `{ … }` pair in blanked source, innermost-resolvable. */
function bracePairs(code: string, rel: string): [number, number][] {
  const stack: number[] = [];
  const pairs: [number, number][] = [];
  for (let i = 0; i < code.length; i += 1) {
    if (code[i] === '{') stack.push(i);
    else if (code[i] === '}') {
      const open = stack.pop();
      // An unbalanced file means the blanking above missed a construct, and
      // every enclosing-function answer below would be quietly wrong.
      expect(open, `${rel}: unbalanced closing brace — the source blanking is wrong`).toBeDefined();
      pairs.push([open!, i]);
    }
  }
  expect(stack, `${rel}: unclosed brace — the source blanking is wrong`).toEqual([]);
  return pairs;
}

const KEYWORDS = ['if', 'for', 'while', 'switch', 'catch', 'with', 'do'];

/** Does `{` at the end of this preceding text open a function body? */
function functionHead(pre0: string): { isFn: boolean; name: string } {
  let pre = pre0.replace(/\s+$/, '');
  if (pre.endsWith('=>')) return { isFn: true, name: '<anonymous>' };
  // `): Promise<Foo> {` — cut the return-type annotation back to its `)`.
  const returnType = /\)\s*:\s*[^()]*$/.exec(pre);
  if (returnType) pre = pre.slice(0, returnType.index + 1);
  if (!pre.endsWith(')')) return { isFn: false, name: '' };
  let depth = 0;
  let i = pre.length - 1;
  for (; i >= 0; i -= 1) {
    if (pre[i] === ')') depth += 1;
    else if (pre[i] === '(') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  if (i < 0) return { isFn: false, name: '' };
  const head = pre.slice(0, i).replace(/\s+$/, '');
  const word = /([A-Za-z_$][\w$]*)$/.exec(head)?.[1] ?? '';
  if (KEYWORDS.includes(word)) return { isFn: false, name: '' };
  return { isFn: true, name: word || '<anonymous>' };
}

/** The innermost function whose body contains `index`. */
function enclosingFunction(
  src: string,
  code: string,
  pairs: [number, number][],
  index: number,
): { name: string; body: string; line: number } | null {
  const containing = pairs
    .filter(([open, close]) => open < index && index < close)
    .sort((a, b) => b[0] - a[0]);
  for (const [open, close] of containing) {
    const head = functionHead(code.slice(Math.max(0, open - 600), open));
    if (!head.isFn) continue;
    return {
      name: head.name,
      body: src.slice(open, close + 1),
      line: src.slice(0, open).split('\n').length,
    };
  }
  return null;
}

/** The body of the named top-level function in a repo-relative source file. */
function namedFunctionBody(rel: string, name: string): string {
  const file = files.find((f) => f.rel === rel);
  expect(file, `${rel} is gone`).toBeDefined();
  const code = codeOnly(file!.src);
  for (const [open, close] of bracePairs(code, rel).sort((a, b) => a[0] - b[0])) {
    if (functionHead(code.slice(Math.max(0, open - 600), open)).name === name) {
      return file!.src.slice(open, close + 1);
    }
  }
  expect.fail(`${rel} no longer declares ${name}()`);
}

/**
 * Every `INSERT INTO messages` in the two services, named by the function that
 * holds it and by the direction it writes.
 *
 * The direction has to be a literal in the VALUES list. One that arrives as a
 * parameter reads as `undeclared` and fails below: a writer that decides at run
 * time whether it is sending or receiving is a writer no static check can clear.
 */
function messageWriters(): { site: string; direction: string }[] {
  const writers: { site: string; direction: string }[] = [];
  for (const file of files) {
    const code = codeOnly(file.src);
    const pairs = bracePairs(code, file.rel);
    for (const m of file.src.matchAll(/INSERT INTO messages\b/g)) {
      const fn = enclosingFunction(file.src, code, pairs, m.index);
      const statement = file.src.slice(m.index, m.index + 600);
      writers.push({
        site: `${file.rel}#${fn?.name ?? '<top level>'}`,
        direction: /VALUES\s*\([^)]*'(inbound|outbound)'/.exec(statement)?.[1] ?? 'undeclared',
      });
    }
  }
  return writers;
}

describe('the outbound chokepoint (F-72)', () => {
  it('is looking at the whole of both services', () => {
    // A path that stopped resolving would make every assertion below vacuous.
    expect(files.length, 'the source scan found almost nothing').toBeGreaterThan(40);
  });

  it('only sendMessage writes an outbound messages row', () => {
    const writers = messageWriters();
    // Two today: the gated outbound write and the inbound receipt. A scan that
    // found neither would make both assertions below pass on nothing.
    expect(writers.length, 'the INSERT scan found no writer of `messages` at all').toBeGreaterThanOrEqual(2);
    expect(
      writers.filter((w) => w.direction === 'outbound').map((w) => w.site),
      'a second writer of an outbound `messages` row is a send that never met evaluateSend — the row exists, the gate never ran, and the kill switch does not reach it. Route it through sendMessage().',
    ).toEqual(['apps/api/src/f19-send.ts#sendMessage']);
    expect(
      writers.filter((w) => w.direction === 'undeclared').map((w) => w.site),
      'this INSERT does not name `inbound` or `outbound` inline, so nothing here can tell a send from a receipt, and the check above would silently stop covering it. Write the direction as a literal.',
    ).toEqual([]);
  });

  it('only f30-deliver reaches the carrier', () => {
    // No exemption list on purpose. `carrier.ts` declares the method as
    // `send(`, which this literal does not match, so an "interface and its
    // implementations" exception would be a permanent stale entry — the shape
    // of exemption this project's guards exist to catch.
    expect(
      holders('carrier.send('),
      'the SMS belt lives in deliverMessage(); a second caller of carrier.send() sends with no belt and no send_decisions row.',
    ).toEqual(['apps/api/src/f30-deliver.ts']);
  });

  it('each gated stager still reaches the gate', () => {
    for (const s of GATED_STAGERS) {
      expect(
        namedFunctionBody(s.file, s.name),
        `${s.name}() no longer calls ${s.reaches} — every call site the chokepoint check accepts on its account is now ungated.`,
      ).toContain(s.reaches);
    }
  });

  it('every delivery runs downstream of a gated send, per call site', () => {
    const offenders: string[] = [];
    const matchedExemptions = new Set<string>();
    let sites = 0;

    for (const file of files) {
      if (file.rel === 'apps/api/src/f30-deliver.ts') continue;
      const code = codeOnly(file.src);
      const pairs = bracePairs(code, file.rel);
      for (const m of code.matchAll(/\bdeliverMessage\s*\(/g)) {
        sites += 1;
        const fn = enclosingFunction(file.src, code, pairs, m.index);
        if (!fn) {
          offenders.push(`${file.rel}: deliverMessage() at top level, in no function at all`);
          continue;
        }
        const exempt = EXEMPT_SITES.find((e) => e.file === file.rel && e.fn === fn.name);
        if (exempt) {
          matchedExemptions.add(`${exempt.file}#${exempt.fn}`);
          // The exemption is not a pass: it is the claim that this site is a
          // redelivery of an already-gated row, and that claim is checked.
          expect(
            fn.body,
            `${file.rel}#${fn.name} is exempt because it redelivers an already-gated message, and the scan that finds one is gone. Re-gate the site or drop the exemption.`,
          ).toContain(exempt.evidence);
          continue;
        }
        if (!GATED_STAGERS.some((s) => fn.body.includes(s.call))) {
          offenders.push(`${file.rel}:${fn.line} (${fn.name})`);
        }
      }
    }

    // Per FILE this assertion is vacuous for drip-tick.ts, which holds both
    // literals — the one file where the ungated path actually lives.
    expect(sites, 'found no deliverMessage() call site outside f30-deliver.ts').toBeGreaterThanOrEqual(6);
    expect(
      offenders,
      `these reach the carrier with no gated stager (${GATED_STAGERS.map((s) => s.call).join(', ')}) in the same function, so evaluateSend never ran for them and neither kill switch applies. Send through sendMessage(), or register the site in EXEMPT_SITES with the reason it is already gated:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
    // A stale exemption is worse than none: it reads as a considered decision
    // about a site that no longer exists.
    for (const e of EXEMPT_SITES) {
      expect(
        matchedExemptions,
        `EXEMPT_SITES names ${e.file}#${e.fn}, which no longer calls deliverMessage(). Delete the entry.`,
      ).toContain(`${e.file}#${e.fn}`);
    }
  });

  it('the switches are read where sends are decided and nowhere else', () => {
    expect(
      holders('killSwitches('),
      'killSwitches() belongs to the send path (the gate, the belt, the compliance preview) and its own module. A fourth reader is a fourth place the switch can be interpreted differently.',
    ).toEqual([
      'apps/api/src/f15-compliance-routes.ts',
      'apps/api/src/f19-send.ts',
      'apps/api/src/f30-deliver.ts',
      'apps/api/src/platform-settings.ts',
    ]);
  });
});
