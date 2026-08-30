import type { FastifyInstance } from 'fastify';
import type { Pool } from '@dealpilot/db';
import {
  AnnouncementListQuery,
  PublishAnnouncementInput,
  type AdminAnnouncementT,
  type AnnouncementAudienceT,
} from '@dealpilot/schemas';
import { notFound, parseOrThrow } from './errors.js';
import { decodeCursor, encodeCursor, idParam } from './f01-routes.js';
import { definer } from './f69-admin-routes.js';
import { requirePlatform } from './platform.js';
import type { DeferredSendQueue } from './deferred-queue.js';

/**
 * F-72 — the console's announcements (admin-console.md §8, §11, §12; D-073).
 *
 * Four handlers. Like f69/f70/f71 this file never opens tenant context and
 * never spells a tenant role — the platform-drift guard greps for both.
 *
 * §12 immutability shapes the surface: publishing IS creating, there is no
 * PATCH and no delete, and the ONE legal mutation is `POST /:id/end`, which
 * moves the display window earlier. §3's "support publishes info only" is
 * enforced twice — two literal capability calls here, and a role re-check
 * inside `admin_publish_announcement`, so a route mistake cannot widen what
 * the database allows.
 *
 * The `end` route asks only for `announcements:publish`. Its severity rule
 * lives in the definer ALONE, deliberately: the severity is unknowable before
 * the row is read, and an admin route file may not name a role.
 */

interface AnnouncementRow {
  id: string;
  severity: string;
  title_en: string;
  title_fr: string;
  body_en: string;
  body_fr: string;
  audience: AnnouncementAudienceT;
  starts_at: Date;
  ends_at: Date | null;
  dismissible: boolean;
  status_incident_url: string | null;
  published_by: string;
  published_by_email: string;
  published_at: Date;
  recipients_notified: number;
}

/**
 * The register's rows carry one column the detail read does not: the Postgres
 * TEXT rendering of `published_at`, which is the keyset's cursor key. A JS
 * `Date` holds milliseconds and Postgres stores microseconds, so encoding the
 * cursor from `published_at.toISOString()` would drop every row published
 * inside the truncated remainder — the f01 lesson, proven live.
 */
interface AnnouncementListRow extends AnnouncementRow {
  published_at_text: string;
}

const adminAnnouncementOf = (row: AnnouncementRow): AdminAnnouncementT => ({
  id: row.id,
  severity: row.severity as AdminAnnouncementT['severity'],
  title_en: row.title_en,
  title_fr: row.title_fr,
  body_en: row.body_en,
  body_fr: row.body_fr,
  audience: row.audience,
  dismissible: row.dismissible,
  starts_at: row.starts_at.toISOString(),
  ends_at: row.ends_at ? row.ends_at.toISOString() : null,
  status_incident_url: row.status_incident_url,
  published_by_email: row.published_by_email,
  published_at: row.published_at.toISOString(),
  recipients_notified: Number(row.recipients_notified),
});

async function readAnnouncement(pool: Pool, actorId: string, id: string): Promise<AdminAnnouncementT> {
  const r = await definer(() =>
    pool.query<AnnouncementRow>('SELECT * FROM admin_get_announcement($1::uuid, $2::uuid)', [actorId, id]),
  );
  const row = r.rows[0];
  if (!row) throw notFound();
  return adminAnnouncementOf(row);
}

/**
 * How long a publish waits for the fan-out enqueue before answering anyway.
 * ioredis buffers commands while Redis is unreachable (`maxRetriesPerRequest:
 * null`), so the add does not reject — it hangs. The banner is the primary
 * delivery and needs no queue, so a bounded wait is better than a request that
 * never returns and an operator who retries into a second immutable
 * announcement.
 */
const ENQUEUE_WAIT_MS = 1500;

export function registerF72AnnouncementRoutes(
  app: FastifyInstance,
  pool: Pool,
  queue: DeferredSendQueue,
): void {
  app.post('/api/v1/admin/announcements', async (request, reply) => {
    const actor = requirePlatform(request, 'announcements:publish');
    const input = parseOrThrow(PublishAnnouncementInput, request.body);
    // Two literals, no ternary: the drift guard reads capabilities as written.
    if (input.severity !== 'info') requirePlatform(request, 'announcements:publish_elevated');
    const r = await definer(() =>
      pool.query<{ id: string }>(
        'SELECT admin_publish_announcement($1::uuid,$2::text,$3::text,$4::text,$5::text,$6::text,$7::jsonb,$8::timestamptz,$9::timestamptz,$10::text) AS id',
        [
          actor.userId,
          input.severity,
          input.title_en,
          input.title_fr,
          input.body_en,
          input.body_fr,
          JSON.stringify(input.audience),
          input.starts_at ?? null,
          input.ends_at ?? null,
          input.status_incident_url ?? null,
        ],
      ),
    );
    const id = r.rows[0]!.id;
    // Post-commit, like every side effect in F-70/F-71. The BANNER is the
    // primary delivery and needs no queue at all; the bell rows are secondary,
    // so neither a missing REDIS_URL nor a sick one may fail the publish. The
    // race is the f03-intake shape and it is the point: with `REDIS_URL` set
    // and Redis unreachable, ioredis buffers the `add` offline and the bare
    // await would HANG — the operator, mid-incident, would retry and publish a
    // second immutable announcement that cannot be deleted.
    //
    // The catch belongs to the ENQUEUE, not to the race. A race abandons its
    // loser, and an abandoned ioredis command still rejects — with "Connection
    // is closed." — when the pool shuts down, by which time nothing is
    // watching. That is an unhandled rejection, and vitest fails a whole run on
    // one even when every test passes (CI 33291543933: 1603/1603 green, exit 1).
    // So: observe the enqueue always, and let the race decide only how long the
    // request WAITS for it.
    const enqueued = queue
      .enqueueAnnouncementFanout({ announcement_id: id })
      .catch((err: unknown) => {
        request.log.warn(
          { announcementId: id, err: err instanceof Error ? err.message : String(err) },
          'announcement fan-out enqueue failed — the banner shows it, but nobody gets a bell row',
        );
      });
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      enqueued,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ENQUEUE_WAIT_MS);
      }),
    ]);
    // An uncleared timer holds the event loop open for its full delay after
    // every publish, which is how a fast suite ends up waiting on nothing.
    clearTimeout(timer);
    request.log.info(
      { announcementId: id, severity: input.severity, audience: input.audience.type },
      'announcement_published',
    );
    return reply.status(201).send(await readAnnouncement(pool, actor.userId, id));
  });

  app.get('/api/v1/admin/announcements', async (request, reply) => {
    const actor = requirePlatform(request, 'announcements:read');
    const query = parseOrThrow(AnnouncementListQuery, request.query);
    // Keyset on (published_at DESC, id DESC), through the same base64url
    // encode/decode pair F-69 uses: a tampered or stale cursor is a 400 from
    // `decodeCursor`, never a raw timestamptz cast raising 22007 as a 500.
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const r = await definer(() =>
      pool.query<AnnouncementListRow>(
        'SELECT * FROM admin_list_announcements($1::uuid, $2::text, $3::timestamptz, $4::uuid, $5::int)',
        [actor.userId, query.severity ?? null, cursor?.c ?? null, cursor?.id ?? null, query.limit],
      ),
    );
    const hasMore = r.rows.length > query.limit;
    const page = r.rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return reply.send({
      items: page.map(adminAnnouncementOf),
      next_cursor: hasMore && last ? encodeCursor(last.published_at_text, last.id) : null,
    });
  });

  app.get('/api/v1/admin/announcements/:id', async (request, reply) => {
    const actor = requirePlatform(request, 'announcements:read');
    return reply.send(await readAnnouncement(pool, actor.userId, idParam(request)));
  });

  app.post('/api/v1/admin/announcements/:id/end', async (request, reply) => {
    const actor = requirePlatform(request, 'announcements:publish');
    const id = idParam(request);
    await definer(() =>
      pool.query('SELECT admin_end_announcement($1::uuid, $2::uuid)', [actor.userId, id]),
    );
    request.log.info({ announcementId: id, staffUserId: actor.userId }, 'announcement_ended');
    return reply.send(await readAnnouncement(pool, actor.userId, id));
  });
}
