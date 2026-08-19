import type { FastifyInstance } from 'fastify';
import { Server as IOServer, type Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import { withTenant, type Pool } from '@dealpilot/db';
import {
  REALTIME_EVENT,
  REALTIME_SUBSCRIBE,
  RealtimeEvent,
  SubscribeRequest,
  roomName,
  type Emitter,
  type RealtimeEventT,
  type RoomDescriptor,
  type SubscribeResultT,
} from '@dealpilot/contracts';
import { hasPermission } from './permissions.js';
import type { PresenceStore } from './presence.js';
import type { Auth } from './auth.js';

/**
 * Realtime (api-design.md §13, ADR-004).
 *
 * ADR-004: "realtime authorization is enforced at join/emit time by application
 * code — RLS no longer implicitly filters the stream". Everything else in this
 * product has the database as a second opinion about who may see a row. This
 * does not, so the rules are written out rather than inherited:
 *
 *  1. THE SOCKET NEVER NAMES A ROOM. It describes what it wants in domain ids;
 *     the server decides, then builds the name with `roomName`. §13 says
 *     "client-supplied room names are never trusted", and the cheapest way to
 *     honour that is to make one impossible to supply.
 *
 *  2. AUTHORIZATION IS RE-CHECKED, NOT PINNED. §13 has the handshake resolve
 *     memberships onto the connection; this goes further and re-reads them from
 *     the database on every subscribe. A socket lives for hours — long enough
 *     for somebody to be removed from an organisation — and a pinned membership
 *     set would keep streaming a rival's customers to a person who was let go
 *     this morning.
 *
 *  3. THE REALTIME BAR EQUALS THE REST BAR. A room is granted on exactly the
 *     authority its HTTP equivalent requires, never less. Conversations need
 *     `conversation:read` because GET /api/v1/conversations does. A stream that
 *     is easier to open than the endpoint it mirrors is a permission system
 *     with a back door.
 *
 *  4. THE SESSION IS RE-VERIFIED. §13: "session revocation disconnects the
 *     socket". A cookie checked once at 09:00 is not a fact at 17:00.
 */

/** How often a live socket must prove its session is still real. */
const SESSION_RECHECK_MS = 5 * 60 * 1000;

export interface RealtimeDeps {
  readonly auth: Auth;
  readonly pool: Pool;
  /** F-43 (D-047): a successful subscribe marks the member online in that org. */
  readonly presence: PresenceStore;
  /** Absent in tests and single-instance dev: Socket.IO fans out in-process. */
  readonly redisUrl?: string | undefined;
  readonly webOrigin: string;
  readonly sessionRecheckMs?: number;
}

interface SocketState {
  userId: string;
  cookie: string;
  /** Orgs this socket has subscribed in — the presence refresher's beat list. */
  orgs: Set<string>;
}

/** How often a live socket re-marks its member online (< the 180s window). */
const PRESENCE_REFRESH_MS = 60 * 1000;

const state = new WeakMap<Socket, SocketState>();

/**
 * Attach a Socket.IO server to the Fastify HTTP server.
 *
 * Deliberately NOT called from `buildApp`. Sixty test files build an app; none
 * of them should open a websocket listener or a Redis connection to do it, and
 * an API that cannot start without a message bus is an API that stops taking
 * orders when the message bus is down.
 */
export async function attachRealtime(
  app: FastifyInstance,
  deps: RealtimeDeps,
): Promise<{ io: IOServer; emitter: Emitter; close: () => Promise<void> }> {
  const io = new IOServer(app.server, {
    path: '/realtime',
    // The SPA is the only origin that may hold a credentialed connection —
    // same rule as the REST surface (H-03), stated again because a websocket
    // upgrade does not go through @fastify/cors.
    cors: { origin: deps.webOrigin, credentials: true },
    // The browser sends the session cookie on the upgrade request; there is no
    // token in a query string to leak into a proxy log.
    cookie: false,
  });

  const redis: Redis[] = [];
  if (deps.redisUrl) {
    // Two connections, because a subscriber connection cannot issue commands.
    const pub = new Redis(deps.redisUrl, { maxRetriesPerRequest: 3, lazyConnect: false });
    const sub = pub.duplicate();
    redis.push(pub, sub);
    io.adapter(createAdapter(pub, sub));
  }

  const recheckMs = deps.sessionRecheckMs ?? SESSION_RECHECK_MS;

  /** Verify a Better Auth session from a raw cookie header. */
  async function sessionUserId(cookie: string | undefined): Promise<string | null> {
    if (!cookie) return null;
    const headers = new Headers();
    headers.set('cookie', cookie);
    const session = await deps.auth.api.getSession({ headers }).catch(() => null);
    return session?.user?.id ?? null;
  }

  io.use(async (socket, next) => {
    const cookie = socket.handshake.headers.cookie;
    const userId = await sessionUserId(cookie);
    // No session, no socket. The message is deliberately vague: an unauthorised
    // connection learns nothing about why.
    if (!userId) return next(new Error('unauthenticated'));
    state.set(socket, { userId, cookie: cookie!, orgs: new Set() });
    next();
  });

  io.on('connection', (socket) => {
    const own = state.get(socket);
    if (!own) return void socket.disconnect(true);

    // §13: session revocation disconnects the socket. A cookie that was valid
    // at connect time is not a standing permission.
    const timer = setInterval(() => {
      void sessionUserId(own.cookie).then((id) => {
        if (id !== own.userId) socket.disconnect(true);
      });
    }, recheckMs);
    timer.unref?.();
    // F-43: while the socket lives, its member stays online in every org it
    // subscribed in. No offline write on disconnect — the 180s TTL retires
    // crashed tabs and clean exits identically (D-047 #1).
    const beat = setInterval(() => {
      for (const org of own.orgs) void deps.presence.touch(org, own.userId);
    }, PRESENCE_REFRESH_MS);
    beat.unref?.();
    socket.on('disconnect', () => {
      clearInterval(timer);
      clearInterval(beat);
    });

    socket.on(REALTIME_SUBSCRIBE, (raw: unknown, ack?: (r: SubscribeResultT) => void) => {
      void (async () => {
        const reply = (r: SubscribeResultT) => ack?.(r);
        const parsed = SubscribeRequest.safeParse(raw);
        if (!parsed.success) return reply({ ok: false, reason: 'malformed' });

        const req = parsed.data;
        // The session is re-verified here as well: subscribing is the moment
        // access is actually granted, and it is the cheapest place to be sure.
        const stillValid = await sessionUserId(own.cookie);
        if (stillValid !== own.userId) {
          socket.disconnect(true);
          return reply({ ok: false, reason: 'not_a_member' });
        }

        const decision = await authorize(deps.pool, own.userId, req);
        if (!decision.ok) return reply(decision);
        await socket.join(decision.room);
        // The subscribe IS the heartbeat: membership was just re-proven for
        // this org, and holding one of its rooms open is what "online" means.
        own.orgs.add(req.organization_id);
        await deps.presence.touch(req.organization_id, own.userId);
        return reply(decision);
      })();
    });
  });

  const emitter: Emitter = {
    emit(room: RoomDescriptor, event: RealtimeEventT) {
      // Parsed on the way out, not merely typed: an event assembled from a
      // database row with a null where a uuid belongs would otherwise reach a
      // browser and fail there, silently, in somebody else's console.
      io.to(roomName(room)).emit(REALTIME_EVENT, RealtimeEvent.parse(event));
    },
  };

  return {
    io,
    emitter,
    close: async () => {
      await io.close();
      for (const r of redis) r.disconnect();
    },
  };
}

/**
 * May this person open this room?
 *
 * Every branch runs under `withTenant`, so RLS scopes the lookups to the
 * organisation being asked about: a store or conversation belonging to somebody
 * else simply is not there, and the answer is the same "no" as for a store that
 * does not exist. The membership check is explicit anyway — under the tenant
 * GUC a non-member's own memberships are invisible, which would make an absent
 * row ambiguous, and ambiguity here resolves to refusal.
 */
async function authorize(
  pool: Pool,
  userId: string,
  req: { kind: string; organization_id: string; conversation_id?: string; store_id?: string },
): Promise<SubscribeResultT> {
  return withTenant(pool, req.organization_id, async (c) => {
    const member = await c.query(
      `SELECT 1 FROM memberships m
       JOIN organizations o ON o.id = m.organization_id AND o.deleted_at IS NULL
       WHERE m.user_id = $1 AND m.organization_id = $2 AND m.status = 'active'`,
      [userId, req.organization_id],
    );
    if (member.rows.length === 0) return { ok: false, reason: 'not_a_member' };

    switch (req.kind) {
      case 'conversation': {
        // The same authority GET /api/v1/conversations requires. Rule 3.
        if (!(await hasPermission(c, userId, 'conversation:read'))) {
          return { ok: false, reason: 'forbidden' };
        }
        const conv = await c.query(
          `SELECT 1 FROM conversations WHERE id = $1 AND deleted_at IS NULL`,
          [req.conversation_id],
        );
        if (conv.rows.length === 0) return { ok: false, reason: 'not_a_member' };
        return {
          ok: true,
          room: roomName({
            kind: 'conversation',
            organizationId: req.organization_id,
            conversationId: req.conversation_id!,
          }),
        };
      }
      case 'leads':
      case 'deals': {
        // Neither list endpoint carries a read permission — membership plus the
        // store is the bar there, so it is the bar here. Rule 3 cuts both ways:
        // a stream must not be EASIER than its endpoint, and inventing a
        // requirement the REST side does not have would make the console lie
        // about what a colleague can see.
        const store = await c.query(
          `SELECT 1 FROM stores WHERE id = $1 AND deleted_at IS NULL`,
          [req.store_id],
        );
        if (store.rows.length === 0) return { ok: false, reason: 'not_a_member' };
        return {
          ok: true,
          room: roomName({
            kind: req.kind === 'leads' ? 'leads' : 'deals',
            organizationId: req.organization_id,
            storeId: req.store_id!,
          }),
        };
      }
      case 'notifications':
        // Their own room and no one else's: the id comes from the verified
        // session, and the request has no field that could name another person.
        return {
          ok: true,
          room: roomName({ kind: 'notifications', organizationId: req.organization_id, userId }),
        };
      default:
        return { ok: false, reason: 'malformed' };
    }
  });
}
