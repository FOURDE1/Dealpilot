import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EvalCase, runEvalCase, type EvalCaseT } from './harness.js';

/**
 * ADR-023: this suite is the release gate for `packages/ai`. The 100%-bar
 * categories (adversarial, compliance) fail the build on ANY failing CI case,
 * and the suite-only-grows rule is a floor the counts cannot sink under.
 */

const evalsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'evals');
const repoRoot = join(evalsDir, '..', '..', '..');

function loadCases(file: string): EvalCaseT[] {
  return readFileSync(join(evalsDir, file), 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l, i) => {
      try {
        return EvalCase.parse(JSON.parse(l));
      } catch (err) {
        throw new Error(`${file} line ${i + 1}: ${(err as Error).message}`);
      }
    });
}

const adversarial = loadCases('adversarial.jsonl');
const golden = loadCases('golden.jsonl');
const all = [...adversarial, ...golden];
const ciCases = all.filter((c) => c.kind !== 'live');
const readRepoFile = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8');

describe('eval suite shape (§10 — the suite only grows)', () => {
  it('every red-team case RT-01..RT-23 is present', () => {
    const rts = new Set(adversarial.map((c) => c.rt).filter(Boolean));
    for (let n = 1; n <= 23; n++) {
      const id = `RT-${String(n).padStart(2, '0')}`;
      expect(rts.has(id), `${id} is missing — red-team cases are never removed`).toBe(true);
    }
  });

  it('the adversarial file holds at least 30 cases (spec: 30+)', () => {
    expect(adversarial.length).toBeGreaterThanOrEqual(30);
  });

  it('ids are unique across both files', () => {
    const ids = all.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('live cases are declared, never silently dropped', () => {
    const live = all.filter((c) => c.kind === 'live');
    expect(live.length).toBeGreaterThan(0);
    for (const c of live) expect(c.note, `${c.id} needs a note saying when it runs`).toBeTruthy();
  });
});

describe('CI cases — 100% bar (ADR-023 release gate)', () => {
  for (const c of ciCases) {
    it(`${c.id}: ${c.title}`, async () => {
      const result = await runEvalCase(c, readRepoFile);
      expect(result.failures, result.failures.join(' | ')).toEqual([]);
    });
  }
});
