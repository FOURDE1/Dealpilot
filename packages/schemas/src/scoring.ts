import { z } from 'zod';
import { CursorQuery, IsoDateTime, Uuid } from './common.js';

/**
 * Lead scoring rules (F-39, leads.md §6) — the wire's side of the engine.
 *
 * The field and operator vocabularies are declared HERE for the contract and in
 * `@dealpilot/core/lead-scoring` for the engine — two lists on purpose, because
 * schemas depends on nothing and core depends on nothing, and a new package
 * edge for two string arrays is the wrong trade. `scoring-vocabulary.test.ts`
 * in the API (which sees both packages) fails the build if they drift.
 */

export const ScoringRuleField = z.enum([
  'source', 'source_platform', 'status', 'preferred_language', 'vehicle_interest',
  'first_name', 'last_name', 'phone', 'email', 'trade_in_status', 'assigned_to',
  'budget', 'has_phone', 'has_email', 'has_trade_in', 'created_days_ago',
]);

export const ScoringRuleOperator = z.enum([
  'gt', 'gte', 'lt', 'lte', 'eq', 'neq',
  'contains', 'not_contains', 'exists', 'not_exists', 'in', 'not_in',
]);

export const LeadScoringRule = z.object({
  id: Uuid,
  organization_id: Uuid,
  /** NULL = a global rule; store rules apply on top for that store. */
  store_id: Uuid.nullable(),
  name: z.string(),
  field: ScoringRuleField,
  operator: ScoringRuleOperator,
  /** Stringly-typed by design (§6.1); comma lists for in/not_in. */
  value: z.string().nullable(),
  /** Signed — a rule may punish (going cold, unassigned). */
  score: z.number().int(),
  is_active: z.boolean(),
  priority: z.number().int(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});

const NEEDS_NO_VALUE = new Set(['exists', 'not_exists']);

export const CreateScoringRuleInput = z.strictObject({
  organization_id: Uuid,
  store_id: Uuid.optional(),
  name: z.string().trim().min(1).max(120),
  field: ScoringRuleField,
  operator: ScoringRuleOperator,
  value: z.string().trim().min(1).max(500).optional(),
  score: z.number().int().min(-100).max(100),
  priority: z.number().int().min(0).max(1000).default(100),
}).refine((v) => NEEDS_NO_VALUE.has(v.operator) || v.value !== undefined, {
  // A comparison rule with no value matches NOTHING (the engine fails closed),
  // so accepting one would store a rule that silently never fires — the
  // dead-vocabulary shape, one row at a time.
  message: 'this operator needs a value to compare against',
  path: ['value'],
});

export const UpdateScoringRuleInput = z.strictObject({
  name: z.string().trim().min(1).max(120).optional(),
  value: z.string().trim().min(1).max(500).nullable().optional(),
  score: z.number().int().min(-100).max(100).optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  is_active: z.boolean().optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'nothing to change' });

export const ScoringRuleListQuery = CursorQuery.extend({
  organization_id: Uuid.optional(),
  store_id: Uuid.optional(),
});

/** What a recalculation reports — the score and every rule that moved it. */
export const LeadScoreResult = z.object({
  lead_id: Uuid,
  score: z.number().int().min(0).max(100),
  band: z.enum(['hot', 'warm', 'cold']),
  breakdown: z.array(z.object({
    rule_id: Uuid,
    rule_name: z.string(),
    field: ScoringRuleField,
    points: z.number().int(),
  })),
  scored_at: IsoDateTime,
});

export type LeadScoringRuleT = z.infer<typeof LeadScoringRule>;
export type CreateScoringRuleInputT = z.infer<typeof CreateScoringRuleInput>;
export type UpdateScoringRuleInputT = z.infer<typeof UpdateScoringRuleInput>;
export type LeadScoreResultT = z.infer<typeof LeadScoreResult>;
