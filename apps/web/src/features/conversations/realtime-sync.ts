import type { RealtimeEventT } from '@dealpilot/contracts';
import { conversationKeys } from './api.js';

/**
 * What a realtime event makes stale.
 *
 * Separated from the component because this is the part with a wrong answer.
 * The transport is proven end to end against a real socket in
 * apps/api/src/f28-realtime.test.ts; what a mounted component cannot easily
 * show is that a status change also invalidates the INBOX, not just the open
 * conversation — miss that and the list keeps saying "Assistant" next to a
 * thread a colleague took ten minutes ago, which is how two people end up
 * answering the same customer.
 *
 * Returns query keys, never data. An event is a nudge to refetch; the fetch
 * decides what the screen shows, so there is only ever one version of what a
 * conversation contains.
 */
export function keysToInvalidate(event: RealtimeEventT): readonly (readonly unknown[])[] {
  switch (event.type) {
    case 'message.created':
      // A new message changes the thread and the inbox's ordering, but not the
      // assistant's analysis — that arrives as its own event when it changes.
      return [conversationKeys.thread(event.conversation_id), conversationKeys.all];
    case 'conversation.changed':
      return [conversationKeys.detail(event.conversation_id), conversationKeys.all];
    case 'analysis.created':
      // F-62: the silent analyst wrote a fresh live_update row — the detail
      // query carries the analysis panel, so it refetches; the inbox doesn't
      // care what the analyst thinks.
      return [conversationKeys.detail(event.conversation_id)];
    case 'lead.changed':
      // Not this screen's business. Returning nothing is the honest answer;
      // invalidating everything "just in case" would refetch the whole console
      // every time a lead's status moved anywhere in the dealership.
      return [];
    case 'notification.created':
      // The bell owns its own refetch (layout's beacon) — same honest nothing.
      return [];
  }
}
