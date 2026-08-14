import { z } from 'zod';

/**
 * The assistant's tools (conversation-engine.md §4).
 *
 * Small and audited (ADR-022). The security property is in what these schemas
 * CANNOT express, so it is worth stating plainly:
 *
 *  - no tool takes an organisation, store, lead or conversation id. Those are
 *    injected server-side from the conversation record, so a model that has been
 *    talked into "looking up the other dealership's stock" has no field to put
 *    the request in.
 *  - no tool takes a destination. Messages go to `conversations.phone_e164` and
 *    nowhere else.
 *  - no tool returns or accepts money. Prices, rates and costs are absent from
 *    every input and every result (§10 guardrail 1).
 *  - no tool changes ownership, status, or consent by assertion.
 *
 * A prompt instruction can be argued with; a missing field cannot.
 */

/** §4: `limit` maxes at three, and three is the default. */
export const LookupInventoryInput = z.strictObject({
  vehicle_type: z.string().min(1).max(40),
  make: z.string().min(1).max(40).optional(),
  model: z.string().min(1).max(40).optional(),
  /**
   * A budget the customer stated, used to RANK results. It never comes back out:
   * the tool answers with vehicles, not with what they cost.
   */
  max_monthly_budget_cents: z.number().int().min(0).max(100_000).optional(),
  limit: z.number().int().min(1).max(3).default(3),
});

export const CheckAgentAvailabilityInput = z.strictObject({
  language: z.enum(['fr', 'en']),
});

export const BookAppointmentInput = z.strictObject({
  type: z.enum(['test_drive', 'showroom_visit', 'phone_call']),
  start_time: z.string().datetime({ offset: true }),
  end_time: z.string().datetime({ offset: true }),
  /** By stock number, so the booking points at a vehicle the tool returned. */
  vehicle_stock_number: z.string().min(1).max(40).optional(),
});

/**
 * §4: a whitelisted-field patch. `assigned_to`, `status`, `store_id` and every
 * consent field are absent — a model cannot assign a lead to itself, mark it
 * converted, move it to another rooftop, or record consent by claiming it.
 */
export const CreateOrUpdateLeadInput = z.strictObject({
  fields: z.strictObject({
    first_name: z.string().trim().min(1).max(100).optional(),
    last_name: z.string().trim().min(1).max(100).optional(),
    email: z.string().email().max(254).optional(),
    vehicle_interest: z.string().trim().min(1).max(200).optional(),
    monthly_budget_cents: z.number().int().min(0).max(100_000).optional(),
    has_trade_in: z.boolean().optional(),
    trade_in_year: z.number().int().min(1900).max(2100).optional(),
    trade_in_make: z.string().trim().min(1).max(40).optional(),
    trade_in_model: z.string().trim().min(1).max(40).optional(),
    trade_in_mileage_km: z.number().int().min(0).max(2_000_000).optional(),
    timeline: z.enum(['now', 'this_week', 'this_month', 'one_to_three_months', 'three_plus_months']).optional(),
    preferred_language: z.enum(['fr-CA', 'en-CA']).optional(),
  }),
});

export const RequestHumanInput = z.strictObject({
  reason: z.enum(['client_asked', 'high_intent', 'cannot_answer', 'complaint', 'safety']),
});

export const SendCreditAppLinkInput = z.strictObject({
  language: z.enum(['fr', 'en']),
});

/**
 * §4: only callable when the customer's immediately preceding message was
 * affirmative — and the server re-reads that message to check, rather than
 * believing the model's account of it.
 *
 * `consent_text_verbatim` is what the customer actually typed. A model that can
 * paraphrase it is a model that can be talked into paraphrasing a "no".
 */
export const RecordConsentInput = z.strictObject({
  scope: z.enum(['ai_outbound_call', 'marketing']),
  consent_text_verbatim: z.string().min(1).max(1000),
});

/** What `lookup_inventory` gives back. No price field exists to be returned. */
export const InventoryResult = z.strictObject({
  stock_number: z.string(),
  year: z.number().int().nullable(),
  make: z.string().nullable(),
  model: z.string().nullable(),
  trim: z.string().nullable(),
  mileage_km: z.number().int().nullable(),
  first_photo_url: z.string().url().nullable(),
});

export type ToolName =
  | 'lookup_inventory'
  | 'check_agent_availability'
  | 'book_appointment'
  | 'create_or_update_lead'
  | 'request_human'
  | 'send_credit_app_link'
  | 'record_consent';

export interface ToolDefinition {
  readonly name: ToolName;
  readonly kind: 'read' | 'write' | 'control';
  readonly description: string;
  readonly input: z.ZodType;
  /** Side-effecting tools write an activity_events row (§4). */
  readonly audited: boolean;
}

export const TOOLS: readonly ToolDefinition[] = [
  {
    name: 'lookup_inventory',
    kind: 'read',
    description:
      'Find up to three available vehicles at this store. Use before mentioning any specific vehicle. Returns no prices.',
    input: LookupInventoryInput,
    audited: false,
  },
  {
    name: 'check_agent_availability',
    kind: 'read',
    description: 'Is somebody available to take over in this language right now, and who.',
    input: CheckAgentAvailabilityInput,
    audited: false,
  },
  {
    name: 'book_appointment',
    kind: 'write',
    description: 'Book a test drive, showroom visit or phone call. Times are checked against store hours.',
    input: BookAppointmentInput,
    audited: true,
  },
  {
    name: 'create_or_update_lead',
    kind: 'write',
    description: 'Record what the customer told you about themselves and what they want.',
    input: CreateOrUpdateLeadInput,
    audited: true,
  },
  {
    name: 'request_human',
    kind: 'control',
    description: 'Hand the conversation to a person. Idempotent, and never a failure.',
    input: RequestHumanInput,
    audited: true,
  },
  {
    name: 'send_credit_app_link',
    kind: 'write',
    description: 'Send the dealership’s credit application link. The message is composed by the server.',
    input: SendCreditAppLinkInput,
    audited: true,
  },
  {
    name: 'record_consent',
    kind: 'write',
    description:
      'Record express consent the customer just gave in words. The server verifies their reply; your account of it is not evidence.',
    input: RecordConsentInput,
    audited: true,
  },
];

/**
 * The tools as the MODEL is told about them (ADR-022).
 *
 * `ToolDefinition.input` is a Zod schema, which is the right thing for
 * validating what comes back and the wrong thing to put on the wire. An API
 * needs JSON Schema, and without `inputSchema` a provider either rejects the
 * tool or — worse — accepts a tool the model can never call correctly.
 *
 * Derived from TOOLS rather than written beside it, so a tool cannot be added
 * to the catalogue and forgotten here. The guard in tools.test.ts asserts the
 * two stay the same length and the same names.
 */
export interface ModelToolSpec {
  readonly name: ToolName;
  readonly description: string;
  /** JSON Schema draft 2020-12, as every current provider expects. */
  readonly inputSchema: Record<string, unknown>;
}

export const MODEL_TOOL_SPECS: readonly ModelToolSpec[] = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  inputSchema: z.toJSONSchema(t.input) as Record<string, unknown>,
}));

/**
 * Field names no tool input may ever contain.
 *
 * Enforced by a test over every schema rather than by review, because the way
 * this rule breaks is somebody adding a helpful `store_id` to one tool so it
 * can "search the other rooftop", and that reads perfectly reasonable in a
 * diff.
 */
export const FORBIDDEN_TOOL_FIELDS = [
  'organization_id', 'tenant_id', 'store_id', 'lead_id', 'conversation_id', 'user_id',
  'assigned_to', 'status', 'phone', 'phone_e164', 'phone_number', 'to', 'recipient',
  'price', 'price_cents', 'list_price_cents', 'msrp_cents', 'cost_cents', 'rate', 'interest_rate_bps',
] as const;
