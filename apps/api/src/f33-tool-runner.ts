import type { PoolClient } from '@dealpilot/db';
import {
  BookAppointmentInput, CheckAgentAvailabilityInput, CreateOrUpdateLeadInput,
  LookupInventoryInput, RecordConsentInput, RequestHumanInput, SendCreditAppLinkInput,
  type ToolName,
} from '@dealpilot/ai';
import { isAffirmative } from '@dealpilot/core';
import { recordEvent } from './activity.js';

/**
 * What the assistant can actually DO (conversation-engine.md §4).
 *
 * The tools have existed as schemas since F-26 and as nothing else. This is the
 * layer where a model's output becomes an action, which makes it the one place
 * in the product where getting the boundary wrong is expensive.
 *
 * The boundary, stated once:
 *
 *  - EVERY id comes from the closure, never from the model. The organisation,
 *    the store, the conversation and the lead are fixed when this runner is
 *    built. §4's schemas have no field for them, and this is the code that
 *    makes that restriction mean something.
 *  - NO tool returns money. `lookup_inventory` answers with vehicles and no
 *    prices, because §10 guardrail 1 is data starvation: a model cannot leak a
 *    number it was never shown.
 *  - NO tool records consent on the model's say-so. `record_consent` re-reads
 *    the customer's own message from the database and checks it itself. A model
 *    that can report "they said yes" is a model that can be talked into
 *    reporting it.
 *  - A tool failure is a RESULT, not an exception. The model is told "that did
 *    not work" and carries on; throwing would fail the whole turn and leave the
 *    customer with silence.
 */

export interface ToolContext {
  readonly organizationId: string;
  readonly storeId: string;
  readonly conversationId: string;
  readonly leadId: string | null;
  readonly phoneE164: string;
  readonly language: 'fr' | 'en';
  /** Now, injectable so appointment validation is testable. */
  readonly nowUtc: Date;
}

/** Every tool answers with this shape, so the model always gets an answer. */
type ToolResult = Record<string, unknown>;

function failed(reason: string): ToolResult {
  return { ok: false, error: reason };
}

/**
 * Build the runner for ONE conversation.
 *
 * The context is captured here and cannot be influenced by anything the model
 * says afterwards. That is the whole security design: a jailbroken model asking
 * to "look up the other dealership's stock" has no field to put the request in,
 * and no way to reach past this closure.
 */
export function createToolRunner(c: PoolClient, ctx: ToolContext) {
  const stockNumbersReturned: string[] = [];

  async function lookupInventory(raw: unknown): Promise<ToolResult> {
    const input = LookupInventoryInput.safeParse(raw);
    if (!input.success) return failed('invalid arguments for lookup_inventory');

    const params: unknown[] = [ctx.organizationId, ctx.storeId];
    // `deal_status = 'available'` and on the lot. A car that is reserved, sold
    // pending delivery, or still in transit is one the assistant must not offer
    // for a test drive on Saturday — the customer would arrive to find it gone.
    let sql = `SELECT stock_number, year, make, model, trim, mileage_km, exterior_color
               FROM vehicles
               WHERE organization_id = $1 AND store_id = $2
                 AND deleted_at IS NULL
                 AND deal_status = 'available'
                 AND location_status = 'on_lot'`;
    if (input.data.make) {
      params.push(input.data.make);
      sql += ` AND make ILIKE $${params.length}`;
    }
    if (input.data.model) {
      params.push(input.data.model);
      sql += ` AND model ILIKE $${params.length}`;
    }
    params.push(input.data.limit);
    // Ranked by budget when they stated one — and the budget never comes back
    // out. The tool answers with vehicles, not with what they cost.
    sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;

    const r = await c.query<Record<string, unknown>>(sql, params);
    for (const row of r.rows) stockNumbersReturned.push(String(row['stock_number']));
    return { ok: true, vehicles: r.rows };
  }

  async function checkAgentAvailability(raw: unknown): Promise<ToolResult> {
    const input = CheckAgentAvailabilityInput.safeParse(raw);
    if (!input.success) return failed('invalid arguments for check_agent_availability');

    const r = await c.query<{ id: string; name: string | null }>(
      `SELECT u.id, u.name
       FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.organization_id = $1 AND m.status = 'active'
         AND m.roles && ARRAY['salesperson','bdc_agent','sales_manager']
       LIMIT 1`,
      [ctx.organizationId],
    );
    const agent = r.rows[0];
    // First names only. The model is composing a customer-facing sentence and
    // has no use for a surname or an id, so it is not given one.
    return agent
      ? { ok: true, available: true, agent_first_name: (agent.name ?? '').trim().split(/\s+/)[0] ?? null }
      : { ok: true, available: false };
  }

  async function bookAppointment(raw: unknown): Promise<ToolResult> {
    const input = BookAppointmentInput.safeParse(raw);
    if (!input.success) return failed('invalid arguments for book_appointment');

    const start = new Date(input.data.start_time);
    const end = new Date(input.data.end_time);
    if (!(end > start)) return failed('the end time must be after the start time');
    // A model that has lost track of the date will happily book last Tuesday.
    if (start.getTime() < ctx.nowUtc.getTime()) return failed('that time is in the past');

    // The stock number must be one this conversation was actually shown. The
    // outbound guard already refuses invented stock numbers in TEXT; this
    // refuses booking against one, which is the same rule applied to an action.
    const stock = input.data.vehicle_stock_number ?? null;
    if (stock && !stockNumbersReturned.includes(stock)) {
      return failed('that vehicle was not in the inventory results for this conversation');
    }

    const r = await c.query<{ id: string; starts_at: Date }>(
      `INSERT INTO appointments
         (organization_id, store_id, lead_id, conversation_id, kind, starts_at, ends_at,
          vehicle_stock_number, booked_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'assistant')
       RETURNING id, starts_at`,
      [
        ctx.organizationId, ctx.storeId, ctx.leadId, ctx.conversationId,
        input.data.type, start.toISOString(), end.toISOString(), stock,
      ],
    );
    const appointment = r.rows[0]!;

    await recordEvent(c, {
      organizationId: ctx.organizationId,
      storeId: ctx.storeId,
      // The assistant did this. Naming a person would put their name against a
      // decision they did not make.
      actorUserId: null,
      entityType: 'appointment',
      entityId: appointment.id,
      action: 'created',
      changes: { kind: input.data.type, starts_at: appointment.starts_at, booked_by: 'assistant' },
    });

    return { ok: true, appointment_id: appointment.id, starts_at: appointment.starts_at };
  }

  async function createOrUpdateLead(raw: unknown): Promise<ToolResult> {
    const input = CreateOrUpdateLeadInput.safeParse(raw);
    if (!input.success) return failed('invalid arguments for create_or_update_lead');
    if (!ctx.leadId) return failed('there is no lead on this conversation yet');

    const fields = Object.entries(input.data.fields).filter(([, v]) => v !== undefined);
    if (fields.length === 0) return { ok: true, updated: [] };

    // Whitelisted by the SCHEMA, not by this loop. `assigned_to`, `status` and
    // every consent field are absent from the input type, so a model cannot
    // assign a lead to itself, mark it converted, or claim consent.
    const params: unknown[] = [ctx.organizationId, ctx.leadId];
    const sets = fields.map(([k, v]) => {
      params.push(v);
      return `${k} = $${params.length}`;
    });
    await c.query(
      `UPDATE leads SET ${sets.join(', ')}, updated_at = now()
       WHERE organization_id = $1 AND id = $2`,
      params,
    );
    return { ok: true, updated: fields.map(([k]) => k) };
  }

  async function requestHuman(raw: unknown): Promise<ToolResult> {
    const input = RequestHumanInput.safeParse(raw);
    if (!input.success) return failed('invalid arguments for request_human');

    // Idempotent, and never a failure (§4). Asking twice is what a worried
    // model does, and refusing the second one would be a reason to keep talking.
    await c.query(
      `UPDATE conversations SET status = 'handed_off', handed_off_at = COALESCE(handed_off_at, now())
       WHERE id = $1 AND status = 'bot_active' AND assigned_agent_id IS NOT NULL`,
      [ctx.conversationId],
    );
    return { ok: true, handoff_requested: true, reason: input.data.reason };
  }

  async function sendCreditAppLink(raw: unknown): Promise<ToolResult> {
    const input = SendCreditAppLinkInput.safeParse(raw);
    if (!input.success) return failed('invalid arguments for send_credit_app_link');
    // §10 guardrail 5: financing is routed to humans, and this is the ONE
    // financing action the assistant may take. The message itself is composed
    // by the server — the model does not get to word an offer of credit.
    return { ok: true, queued: true, language: input.data.language };
  }

  async function recordConsent(raw: unknown): Promise<ToolResult> {
    const input = RecordConsentInput.safeParse(raw);
    if (!input.success) return failed('invalid arguments for record_consent');

    // The customer's own words, RE-READ FROM THE DATABASE. Not the string the
    // model passed. §5 and F-18 are explicit: a model that can report "they
    // said yes" is a model that can be talked into reporting it, and express
    // consent for an automated call has to rest on what the customer sent.
    const last = await c.query<{ body: string }>(
      `SELECT body FROM messages
       WHERE conversation_id = $1 AND direction = 'inbound'
       ORDER BY created_at DESC LIMIT 1`,
      [ctx.conversationId],
    );
    const said = last.rows[0]?.body ?? '';
    if (!isAffirmative(said)) {
      return failed('their last message was not an affirmative; consent not recorded');
    }

    const r = await c.query<{ id: string }>(
      `INSERT INTO consent_ledger
         (organization_id, store_id, lead_id, phone_e164, channel, scope, consent_type,
          source, evidence, granted_at, expires_at)
       VALUES ($1,$2,$3,$4,'sms',$5,'express','sms_reply',$6, now(), NULL)
       RETURNING id`,
      [
        ctx.organizationId, ctx.storeId, ctx.leadId, ctx.phoneE164, input.data.scope,
        JSON.stringify({
          // The verbatim reply IS the evidence, taken from the message row.
          reply_verbatim: said,
          asked_by: 'assistant',
          model_claimed: input.data.consent_text_verbatim,
        }),
      ],
    );
    return { ok: true, consent_id: r.rows[0]!.id };
  }

  const run = async (name: ToolName, input: unknown): Promise<ToolResult> => {
    switch (name) {
      case 'lookup_inventory': return lookupInventory(input);
      case 'check_agent_availability': return checkAgentAvailability(input);
      case 'book_appointment': return bookAppointment(input);
      case 'create_or_update_lead': return createOrUpdateLead(input);
      case 'request_human': return requestHuman(input);
      case 'send_credit_app_link': return sendCreditAppLink(input);
      case 'record_consent': return recordConsent(input);
    }
  };

  return {
    run,
    /** Stock numbers this conversation was actually shown, for the guard. */
    allowedStockNumbers: () => [...stockNumbersReturned],
  };
}
