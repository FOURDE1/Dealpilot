import { z } from 'zod';
import { CursorQuery, IsoDateTime, Uuid } from './common.js';

/**
 * Lead assignment rules (F-40, leads.md §7) — the wire's side of the engine.
 * The strategy vocabulary is mirrored in @dealpilot/core and the 0046 CHECKs;
 * assignment-vocabulary coverage lives in scoring-vocabulary.test.ts's sibling
 * assertions in the API package.
 */

export const AssignmentStrategy = z.enum(['round_robin', 'load_balanced', 'source_based']);

export const LeadAssignmentRule = z.object({
  id: Uuid,
  organization_id: Uuid,
  name: z.string(),
  strategy: AssignmentStrategy,
  is_active: z.boolean(),
  /** ASCENDING — lower checked first (§7.1). The opposite of scoring. */
  priority: z.number().int(),
  /** Empty = catch-all. */
  sources: z.array(z.string()),
  /** Empty = every active member. */
  included_users: z.array(Uuid),
  excluded_users: z.array(Uuid),
  /** source → user_id, for source_based. */
  source_mappings: z.record(z.string(), Uuid),
  /** 0 = unlimited. */
  max_leads_per_user: z.number().int(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});

export const CreateAssignmentRuleInput = z.strictObject({
  organization_id: Uuid,
  name: z.string().trim().min(1).max(120),
  strategy: AssignmentStrategy.default('round_robin'),
  priority: z.number().int().min(0).max(1000).default(1),
  sources: z.array(z.string().trim().min(1)).max(50).default([]),
  included_users: z.array(Uuid).max(200).default([]),
  excluded_users: z.array(Uuid).max(200).default([]),
  source_mappings: z.record(z.string(), Uuid).default({}),
  max_leads_per_user: z.number().int().min(0).max(1000).default(0),
});

export const UpdateAssignmentRuleInput = z.strictObject({
  name: z.string().trim().min(1).max(120).optional(),
  strategy: AssignmentStrategy.optional(),
  is_active: z.boolean().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  sources: z.array(z.string().trim().min(1)).max(50).optional(),
  included_users: z.array(Uuid).max(200).optional(),
  excluded_users: z.array(Uuid).max(200).optional(),
  source_mappings: z.record(z.string(), Uuid).optional(),
  max_leads_per_user: z.number().int().min(0).max(1000).optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'nothing to change' });

export const AssignmentRuleListQuery = CursorQuery.extend({
  organization_id: Uuid.optional(),
});

/** What an auto-assignment attempt reports — including its named refusals. */
export const AssignLeadResult = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('assigned'),
    lead_id: Uuid,
    assigned_to: Uuid,
    rule_id: Uuid,
    rule_name: z.string(),
    strategy: AssignmentStrategy,
  }),
  z.object({
    /**
     * Three refusals with three remedies: write a rule, include somebody, or
     * raise the cap. `already_assigned` is the fourth honest answer — the auto
     * path NEVER reassigns (§7.2); taking a lead off somebody is a human act.
     */
    outcome: z.enum(['no_rule', 'no_eligible_users', 'all_at_capacity', 'already_assigned']),
    lead_id: Uuid,
  }),
]);

export type LeadAssignmentRuleT = z.infer<typeof LeadAssignmentRule>;
export type CreateAssignmentRuleInputT = z.infer<typeof CreateAssignmentRuleInput>;
export type UpdateAssignmentRuleInputT = z.infer<typeof UpdateAssignmentRuleInput>;
export type AssignLeadResultT = z.infer<typeof AssignLeadResult>;
