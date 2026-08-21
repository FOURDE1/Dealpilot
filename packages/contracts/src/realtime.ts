import { z } from 'zod';

/**
 * The realtime contract (api-design.md §13, ADR-004).
 *
 * ADR-004 is unusually blunt about what this layer does NOT get: "realtime
 * authorization is enforced at join/emit time by application code — RLS no
 * longer implicitly filters the stream". Every other read path in this product
 * has the database as a second opinion. This one does not. If a room name is
 * built wrong, one dealership's customer conversations arrive in a rival's
 * browser and nothing in Postgres will stop it.
 *
 * So a room name is not a string anybody may write. It is the return value of
 * `roomName`, which takes a typed descriptor and is the only function in the
 * codebase that produces the `tenant:` prefix. The guard in
 * apps/api/src/realtime-vocabulary.test.ts fails the build if a second one
 * appears.
 */

/** Rooms, exactly as api-design.md §13 names them. */
export type RoomDescriptor =
  | { readonly kind: 'deals'; readonly organizationId: string; readonly storeId: string }
  | { readonly kind: 'leads'; readonly organizationId: string; readonly storeId: string }
  | { readonly kind: 'notifications'; readonly organizationId: string; readonly userId: string }
  | { readonly kind: 'presence'; readonly organizationId: string }
  | { readonly kind: 'conversation'; readonly organizationId: string; readonly conversationId: string };

/**
 * The one place a room name is made.
 *
 * Every branch begins `tenant:${organizationId}:` — §13: "Room names are always
 * prefixed `tenant:{tenantId}:`". The ids are checked rather than trusted,
 * because a room name assembled from an unvalidated string is a room name an
 * attacker can choose: `tenant:*` or a name carrying a `:` would silently widen
 * the subscription.
 */
export function roomName(room: RoomDescriptor): string {
  const org = requireId(room.organizationId, 'organizationId');
  switch (room.kind) {
    case 'deals':
      return `tenant:${org}:store:${requireId(room.storeId, 'storeId')}:deals`;
    case 'leads':
      return `tenant:${org}:store:${requireId(room.storeId, 'storeId')}:leads`;
    case 'notifications':
      return `tenant:${org}:user:${requireId(room.userId, 'userId')}:notifications`;
    case 'presence':
      return `tenant:${org}:presence:agents`;
    case 'conversation':
      return `tenant:${org}:conversation:${requireId(room.conversationId, 'conversationId')}`;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireId(value: string, field: string): string {
  if (!UUID.test(value)) {
    throw new Error(`realtime: ${field} must be a uuid, refusing to build a room name from ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * What a browser is allowed to ASK for.
 *
 * Deliberately not a room name. The client describes what it wants in terms of
 * domain ids; the server decides whether that is allowed and then builds the
 * name itself. §13: "client-supplied room names are never trusted" — the
 * cheapest way to honour that is to make it impossible to supply one.
 */
export const SubscribeRequest = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('conversation'), organization_id: z.uuid(), conversation_id: z.uuid() }),
  z.object({ kind: z.literal('leads'), organization_id: z.uuid(), store_id: z.uuid() }),
  z.object({ kind: z.literal('deals'), organization_id: z.uuid(), store_id: z.uuid() }),
  z.object({ kind: z.literal('notifications'), organization_id: z.uuid() }),
]);
export type SubscribeRequestT = z.infer<typeof SubscribeRequest>;

/** What the server sends back when a subscription is refused. */
export const SubscribeResult = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), room: z.string() }),
  z.object({ ok: z.literal(false), reason: z.enum(['not_a_member', 'forbidden', 'malformed']) }),
]);
export type SubscribeResultT = z.infer<typeof SubscribeResult>;

/**
 * Events, and the tenant that owns each one.
 *
 * `organization_id` is on the payload as well as in the room name on purpose:
 * §13 requires "a tenant-scoped payload", and it means a subscriber can check
 * what it received rather than trusting the channel it arrived on. Belt and
 * braces on the one path where the database is not watching.
 */
export const RealtimeEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('message.created'),
    organization_id: z.uuid(),
    conversation_id: z.uuid(),
    message_id: z.uuid(),
    direction: z.enum(['inbound', 'outbound']),
    sender_type: z.enum(['client', 'bot', 'agent', 'system', 'drip']),
    body: z.string(),
    created_at: z.string(),
  }),
  z.object({
    type: z.literal('conversation.changed'),
    organization_id: z.uuid(),
    conversation_id: z.uuid(),
    status: z.enum(['bot_active', 'handed_off', 'agent_active', 'drip_active', 'closed']),
    assigned_agent_id: z.uuid().nullable(),
  }),
  z.object({
    type: z.literal('lead.changed'),
    organization_id: z.uuid(),
    store_id: z.uuid(),
    lead_id: z.uuid(),
    status: z.string(),
  }),
  // F-47: a REFRESH HINT, not the notification itself — the row is the truth
  // and the bell refetches on sight of this (D-050).
  z.object({
    type: z.literal('notification.created'),
    organization_id: z.uuid(),
    user_id: z.uuid(),
  }),
  // F-62 silent monitoring: a fresh conversation_analysis row landed for a
  // human-held thread. A refresh hint like the bell's — the row is the truth
  // and the panel refetches the conversation on sight of this.
  z.object({
    type: z.literal('analysis.created'),
    organization_id: z.uuid(),
    conversation_id: z.uuid(),
  }),
]);
export type RealtimeEventT = z.infer<typeof RealtimeEvent>;

/** The channel every server event travels on. One name, so a client binds once. */
export const REALTIME_EVENT = 'dealpilot:event';
export const REALTIME_SUBSCRIBE = 'dealpilot:subscribe';

/**
 * Emit, or don't.
 *
 * Routes hold this, never a Socket.IO server. Two consequences: the API runs
 * perfectly well with no realtime attached (the no-op below), and a route
 * cannot reach past this interface to a raw `io.to('some string')`.
 */
export interface Emitter {
  emit(room: RoomDescriptor, event: RealtimeEventT): void;
}

/**
 * The default. An API with no realtime layer attached is a working API.
 *
 * Silence is the right failure mode here: a dropped notification costs a
 * refresh, while making the write path depend on a websocket would let a Redis
 * hiccup roll back a customer's message.
 */
export const NO_EMITTER: Emitter = { emit() {} };

/**
 * An emitter that can be pointed somewhere later.
 *
 * Solves an ordering problem, not a design one: the routes need an emitter when
 * they are registered, and the real emitter needs the HTTP server that
 * registering them creates. The relay is handed out first and aimed afterwards.
 *
 * Silent in between, which is the correct behaviour for that window — the
 * server is not listening yet, so there is nobody to tell.
 */
export function relayEmitter(): Emitter & { pointTo(target: Emitter): void } {
  let target: Emitter = NO_EMITTER;
  return {
    pointTo(next: Emitter) {
      target = next;
    },
    emit(room, event) {
      target.emit(room, event);
    },
  };
}

/** An emitter that remembers, for tests that assert what WOULD have gone out. */
export function recordingEmitter(): Emitter & { sent: { room: string; event: RealtimeEventT }[] } {
  const sent: { room: string; event: RealtimeEventT }[] = [];
  return {
    sent,
    emit(room, event) {
      // Validate here too: a test that records a malformed event would happily
      // pass while production threw.
      sent.push({ room: roomName(room), event: RealtimeEvent.parse(event) });
    },
  };
}
