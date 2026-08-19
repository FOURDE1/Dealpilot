import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ASSIGNMENT_STRATEGIES, SCORING_FIELDS, SCORING_OPERATORS } from '@dealpilot/core';
import { AssignmentStrategy, ScoringRuleField, ScoringRuleOperator } from '@dealpilot/schemas';

/**
 * The scoring vocabulary lives in THREE places on purpose — the engine
 * (@dealpilot/core, which depends on nothing), the contract
 * (@dealpilot/schemas, which depends on nothing), and the 0045 CHECK
 * constraints — because a new package edge for two string arrays is the wrong
 * trade. Three copies that can drift is the `timezone_source` bug waiting to
 * happen: a field the API accepts, the engine ignores, and the database
 * refuses, each silently. This file is the lockstep.
 */

const migration = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations', '20260727000045_lead-scoring.sql'),
  'utf8',
);

/** Every quoted token inside the named CHECK's IN (...) list. */
function checkList(constraintFor: 'field' | 'operator'): string[] {
  const m = migration.match(new RegExp(`${constraintFor}\\s+text NOT NULL CHECK \\(${constraintFor} IN \\(([^)]+)\\)`, 's'));
  if (!m) return [];
  return [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
}

describe('one vocabulary, three declarations', () => {
  it('engine and contract agree on fields', () => {
    expect([...ScoringRuleField.options].sort()).toEqual([...SCORING_FIELDS].sort());
  });

  it('engine and contract agree on operators', () => {
    expect([...ScoringRuleOperator.options].sort()).toEqual([...SCORING_OPERATORS].sort());
  });

  it('assignment strategies agree across core, schemas and the 0046 CHECKs', () => {
    expect([...AssignmentStrategy.options].sort()).toEqual([...ASSIGNMENT_STRATEGIES].sort());
    const m46 = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations', '20260727000046_lead-assignment.sql'),
      'utf8',
    );
    // Both CHECKs (rules.strategy and history.strategy) must carry the same
    // list; collect every strategy CHECK in the file and compare each.
    const lists = [...m46.matchAll(/CHECK \(strategy IN \(([^)]+)\)/g)].map((m) =>
      [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!).sort(),
    );
    expect(lists.length).toBe(2);
    for (const list of lists) expect(list).toEqual([...ASSIGNMENT_STRATEGIES].sort());
  });

  it('the 0045 CHECK constraints match the engine', () => {
    const fields = checkList('field');
    const operators = checkList('operator');
    // A parse failure would make both empty and the equality vacuous.
    expect(fields.length).toBeGreaterThan(10);
    expect(operators.length).toBeGreaterThan(8);
    expect(fields.sort()).toEqual([...SCORING_FIELDS].sort());
    expect(operators.sort()).toEqual([...SCORING_OPERATORS].sort());
  });
});
