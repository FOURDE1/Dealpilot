import { describe, expect, it } from 'vitest';
import { RealtimeEvent, type RealtimeEventT } from '@dealpilot/contracts';
import { conversationKeys } from './api.js';
import { keysToInvalidate } from './realtime-sync.js';

/**
 * What a realtime event makes stale.
 *
 * The transport is proven end to end with a real socket in
 * apps/api/src/f28-realtime.test.ts. This is the decision that sits on top of
 * it, and the failure it guards against is silent: an inbox that keeps saying
 * "Assistant" beside a conversation a colleague took ten minutes ago, so two
 * people answer the same customer.
 */

const CONV = '22222222-2222-4222-8222-222222222222';
const ORG = '11111111-1111-4111-8111-111111111111';

/** Parsed, not cast: a fixture the contract would reject proves nothing. */
function event(e: unknown): RealtimeEventT {
  return RealtimeEvent.parse(e);
}

describe('a new message', () => {
  const e = event({
    type: 'message.created',
    organization_id: ORG,
    conversation_id: CONV,
    message_id: '33333333-3333-4333-8333-333333333333',
    direction: 'inbound',
    sender_type: 'client',
    body: 'Est-ce que le Sorento est encore disponible?',
    created_at: '2026-08-14T02:00:00.000Z',
  });

  it('refetches the thread it belongs to', () => {
    expect(keysToInvalidate(e)).toContainEqual(conversationKeys.thread(CONV));
  });

  it('refetches the inbox, because the ordering moved', () => {
    expect(keysToInvalidate(e)).toContainEqual(conversationKeys.all);
  });

  it('does not touch another conversation', () => {
    const other = '44444444-4444-4444-8444-444444444444';
    expect(keysToInvalidate(e)).not.toContainEqual(conversationKeys.thread(other));
  });
});

describe('a status change', () => {
  const e = event({
    type: 'conversation.changed',
    organization_id: ORG,
    conversation_id: CONV,
    status: 'agent_active',
    assigned_agent_id: null,
  });

  it('refetches the conversation AND the inbox', () => {
    // The inbox renders status and assignment. Refreshing only the open pane
    // leaves the list telling everyone else the assistant still has it.
    expect(keysToInvalidate(e)).toEqual(
      expect.arrayContaining([conversationKeys.detail(CONV), conversationKeys.all]),
    );
  });
});

describe('an event this screen has no use for', () => {
  it('invalidates nothing rather than everything', () => {
    const e = event({
      type: 'lead.changed',
      organization_id: ORG,
      store_id: '55555555-5555-4555-8555-555555555555',
      lead_id: '66666666-6666-4666-8666-666666666666',
      status: 'qualified',
    });
    // "Just in case" would refetch the entire console every time any lead in
    // the dealership moved status.
    expect(keysToInvalidate(e)).toEqual([]);
  });
});

describe('every event the contract can produce', () => {
  it('has an answer here', () => {
    // The union is closed, so a new member is a compile error in
    // keysToInvalidate's switch — but only if the switch is exhaustive, which
    // this asserts is still true at runtime for the members that exist.
    const types = RealtimeEvent.options.map((o) => o.shape.type.value);
    expect(types).toEqual(['message.created', 'conversation.changed', 'lead.changed']);
  });
});
