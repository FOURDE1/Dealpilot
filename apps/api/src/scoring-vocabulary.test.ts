import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ASSIGNMENT_STRATEGIES, SCORING_FIELDS, SCORING_OPERATORS, ASSIGNMENT_METHODS, CASCADE_STRATEGY, CASCADE_REFUSALS, DISTRIBUTION_PLATFORMS } from '@dealpilot/core';
import { AssignmentStrategy, ScoringRuleField, ScoringRuleOperator, AssignmentMethod, CascadeRefusal, DistributionPlatform } from '@dealpilot/schemas';

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

  it('assignment strategies agree across core, schemas and the live CHECKs', () => {
    expect([...AssignmentStrategy.options].sort()).toEqual([...ASSIGNMENT_STRATEGIES].sort());
    const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');
    const m46 = readFileSync(join(migrationsDir, '20260727000046_lead-assignment.sql'), 'utf8');
    const m49 = readFileSync(join(migrationsDir, '20260819000049_assignment-cascade.sql'), 'utf8');
    const listsIn = (sql: string) =>
      [...sql.matchAll(/CHECK \(strategy IN \(([^)]+)\)/g)].map((m) =>
        [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!).sort(),
      );
    // The RULES check is 0046's, unchanged: a rule cannot BE the cascade
    // (D-045 #9). The HISTORY check's live truth moved to 0049 and includes
    // 'cascade'. Both 0046 lists still parse (guard against a vacuous regex).
    const lists46 = listsIn(m46);
    expect(lists46.length).toBe(2);
    for (const list of lists46) expect(list).toEqual([...ASSIGNMENT_STRATEGIES].sort());
    const lists49 = listsIn(m49);
    expect(lists49.length).toBe(1);
    expect(lists49[0]).toEqual([...ASSIGNMENT_STRATEGIES, CASCADE_STRATEGY].sort());
  });

  it('distribution platforms agree across core, schemas and the 0050 CHECK (F-45)', () => {
    expect([...DistributionPlatform.options].sort()).toEqual([...DISTRIBUTION_PLATFORMS].sort());
    const m50 = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations', '20260819000050_lead-distribution.sql'),
      'utf8',
    );
    const m = /CHECK \(platform IN \(([^)]+)\)/.exec(m50);
    const list = [...(m?.[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1]!).sort();
    expect(list.length).toBe(2); // vacuous-parse guard
    expect(list).toEqual([...DISTRIBUTION_PLATFORMS].sort());
  });

  it('cascade refusals agree between core and schemas (F-42)', () => {
    expect([...CascadeRefusal.options].sort()).toEqual([...CASCADE_REFUSALS].sort());
  });

  it('assignment methods agree across core, schemas and the 0049 CHECK (F-42)', () => {
    expect([...AssignmentMethod.options].sort()).toEqual([...ASSIGNMENT_METHODS].sort());
    const m49 = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations', '20260819000049_assignment-cascade.sql'),
      'utf8',
    );
    const m = /CHECK \(assignment_method IN\s*\(([^)]+)\)/.exec(m49);
    const list = [...(m?.[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1]!).sort();
    expect(list.length).toBeGreaterThan(3); // vacuous-parse guard
    expect(list).toEqual([...ASSIGNMENT_METHODS].sort());
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
