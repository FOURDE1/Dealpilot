import type { FastifyInstance } from 'fastify';
import { withUser, type Pool } from '@dealpilot/db';
import { notFound } from './errors.js';
import { idParam, sessionUser } from './f01-routes.js';

/**
 * F-47 — the bell's API (automation-notifications.md §5/§14, D-050).
 *
 * Everything here is SELF-scoped: the routes run under withUser and the 0051
 * self-read/self-update policies make another person's bell literally
 * invisible — there is no organization_id parameter to even ask with.
 */

export function registerF47Routes(app: FastifyInstance, pool: Pool): void {
  /** The 20 most recent, plus the true unread count (the badge's number). */
  app.get('/api/v1/notifications', async (request, reply) => {
    const user = sessionUser(request);
    const result = await withUser(pool, user.id, async (c) => {
      const items = await c.query(
        `SELECT * FROM notifications ORDER BY created_at DESC, id DESC LIMIT 20`,
      );
      const unread = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM notifications WHERE read_at IS NULL`,
      );
      return { items: items.rows, unread: unread.rows[0]?.n ?? 0 };
    });
    return reply.send(result);
  });

  app.post('/api/v1/notifications/:id/read', async (request, reply) => {
    const id = idParam(request);
    const user = sessionUser(request);
    await withUser(pool, user.id, async (c) => {
      const r = await c.query(
        `UPDATE notifications SET read_at = now() WHERE id = $1 AND read_at IS NULL`,
        [id],
      );
      // Zero rows = not mine, or already read. Re-reading an open one is not
      // an error worth surfacing; a foreign id must stay indistinguishable.
      if (r.rowCount === 0) {
        const mine = await c.query(`SELECT 1 FROM notifications WHERE id = $1`, [id]);
        if (mine.rows.length === 0) throw notFound();
      }
    });
    return reply.status(204).send();
  });

  app.post('/api/v1/notifications/read-all', async (request, reply) => {
    const user = sessionUser(request);
    await withUser(pool, user.id, async (c) => {
      await c.query(`UPDATE notifications SET read_at = now() WHERE read_at IS NULL`);
    });
    return reply.status(204).send();
  });
}
