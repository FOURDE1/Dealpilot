import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  CreateOrUpdateLeadInput, FORBIDDEN_TOOL_FIELDS, InventoryResult, LookupInventoryInput,
  RecordConsentInput, TOOLS,
} from './definitions.js';

/**
 * §4's security property lives in what these schemas cannot express.
 *
 * A prompt instruction can be argued with by a determined customer; a missing
 * field cannot. So the tests that matter here are the ones asserting ABSENCE —
 * and the way that rule breaks in practice is somebody adding a helpful
 * `store_id` to one tool so it can "search the other rooftop", which reads
 * perfectly reasonable in a diff and is a cross-tenant read.
 */

/** Every property name a Zod object accepts, recursively. */
function fieldNames(schema: z.ZodType): string[] {
  const out: string[] = [];
  const walk = (s: z.ZodType) => {
    const def = s as unknown as { _def?: { typeName?: string; innerType?: z.ZodType; shape?: unknown } };
    const inner = def._def?.innerType;
    if (inner) return walk(inner);
    const shape = (s as unknown as { shape?: Record<string, z.ZodType> }).shape;
    if (!shape) return;
    for (const [key, value] of Object.entries(shape)) {
      out.push(key);
      walk(value);
    }
  };
  walk(schema);
  return out;
}

describe('what a tool cannot be asked to do', () => {
  it('parses every schema, so the absence checks below are not vacuous', () => {
    // If fieldNames ever returns nothing, every "does not contain" assertion
    // passes for the wrong reason.
    for (const tool of TOOLS) {
      expect(fieldNames(tool.input).length, tool.name).toBeGreaterThan(0);
    }
  });

  it('never takes a tenant, store, lead or conversation', () => {
    // These are injected server-side from the conversation record. A model
    // talked into reading another dealership's stock has nowhere to put it.
    for (const tool of TOOLS) {
      const fields = fieldNames(tool.input);
      for (const forbidden of FORBIDDEN_TOOL_FIELDS) {
        expect(fields, `${tool.name}.${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('never takes a destination', () => {
    const all = TOOLS.flatMap((t) => fieldNames(t.input));
    for (const destination of ['phone', 'phone_e164', 'to', 'recipient', 'email_to']) {
      expect(all).not.toContain(destination);
    }
  });

  it('never lets the assistant assign, close or convert a lead', () => {
    const fields = fieldNames(CreateOrUpdateLeadInput);
    for (const owned of ['assigned_to', 'status', 'store_id', 'consent', 'score']) {
      expect(fields).not.toContain(owned);
    }
  });

  it('returns no price from an inventory lookup', () => {
    const fields = fieldNames(InventoryResult);
    for (const money of ['price', 'price_cents', 'list_price_cents', 'msrp_cents', 'cost_cents']) {
      expect(fields).not.toContain(money);
    }
    // And the result shape is closed, so an implementation cannot bolt one on.
    expect(() =>
      InventoryResult.parse({
        stock_number: 'K1', year: 2024, make: 'Kia', model: 'Sorento', trim: 'EX',
        mileage_km: 10, first_photo_url: null, list_price_cents: 4_299_500,
      }),
    ).toThrow();
  });
});

describe('the shapes the spec pins down', () => {
  it('caps an inventory lookup at three, and defaults to three', () => {
    expect(LookupInventoryInput.parse({ vehicle_type: 'suv' }).limit).toBe(3);
    expect(() => LookupInventoryInput.parse({ vehicle_type: 'suv', limit: 4 })).toThrow();
    // Not because three is magic, but because photo sends are capped at three
    // per conversation and a longer list invites the model to enumerate.
    expect(LookupInventoryInput.parse({ vehicle_type: 'suv', limit: 1 }).limit).toBe(1);
  });

  it('rejects an unknown field rather than ignoring it', () => {
    // strictObject everywhere: a model that invents `store_id: "other"` must
    // fail loudly, not have it silently dropped and the call succeed.
    expect(() => LookupInventoryInput.parse({ vehicle_type: 'suv', store_id: 'x' })).toThrow();
    expect(() => RecordConsentInput.parse({ scope: 'marketing', consent_text_verbatim: 'oui', lead_id: 'x' }))
      .toThrow();
  });

  it('takes the customer’s words verbatim for consent, and requires some', () => {
    expect(() => RecordConsentInput.parse({ scope: 'marketing', consent_text_verbatim: '' })).toThrow();
    const ok = RecordConsentInput.parse({ scope: 'ai_outbound_call', consent_text_verbatim: 'Oui, appelez-moi' });
    expect(ok.consent_text_verbatim).toBe('Oui, appelez-moi');
  });

  it('marks every side-effecting tool as audited', () => {
    for (const tool of TOOLS) {
      if (tool.kind === 'read') continue;
      // §4: side-effecting tools write an activity_events row. A write nobody
      // can trace back to the turn that caused it is a write nobody can review.
      expect(tool.audited, tool.name).toBe(true);
    }
  });

  it('has exactly the seven tools §4 names', () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual([
      'book_appointment', 'check_agent_availability', 'create_or_update_lead',
      'lookup_inventory', 'record_consent', 'request_human', 'send_credit_app_link',
    ]);
  });
});
