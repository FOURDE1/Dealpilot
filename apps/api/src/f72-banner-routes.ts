import type { FastifyInstance } from 'fastify';
import { withUser, type Pool } from '@dealpilot/db';
import type { AnnouncementT } from '@dealpilot/schemas';
import { idParam, sessionUser } from './f01-routes.js';
import { definer } from './f69-admin-routes.js';

/**
 * F-72 — what a tenant user is told (admin-console.md §8; D-073).
 *
 * A TENANT route file, kept apart from the console's on purpose: it opens user
 * context (`withUser`), which the platform-drift guard forbids in an admin
 * route file, and it must contain no console path literal at all. The
 * `f71-support-access-routes.ts` precedent exactly.
 *
 * Three containment properties, structural rather than promised:
 *
 *  1. **Neither handler takes a recipient.** `announcements_for_user()` and
 *     `announcement_dismiss()` read the person from the `app.user_id` GUC that
 *     `withUser` sets, so there is no argument a route bug could get wrong and
 *     no way to ask for somebody else's announcements or dismiss on their
 *     behalf.
 *  2. **No organization parameter exists.** Like the bell, this is self-scoped;
 *     the definer walks the caller's own active memberships.
 *  3. **The payload names no tenant.** No organization id, no plan, no
 *     audience — a defect in the audience matcher could leak a
 *     platform-authored message; it could not leak who else is a customer.
 *
 * Under a support session `withUser` also sets `app.impersonation_org`, and
 * the definer carries `impersonation_scope_ok(o.id)`, so a staffer sees only
 * the announcements of the tenant they are scoped to. Dismissing is refused
 * outright in both modes (`IMPERSONATION_BLOCKED_ROUTES`): silencing a notice
 * is permanent and would be recorded in the dealer's name.
 */

interface AnnouncementRow {
  id: string;
  severity: string;
  title_en: string;
  title_fr: string;
  body_en: string;
  body_fr: string;
  dismissible: boolean;
  starts_at: Date;
  ends_at: Date | null;
  status_incident_url: string | null;
}

const announcementOf = (row: AnnouncementRow): AnnouncementT => ({
  id: row.id,
  severity: row.severity as AnnouncementT['severity'],
  title_en: row.title_en,
  title_fr: row.title_fr,
  body_en: row.body_en,
  body_fr: row.body_fr,
  dismissible: row.dismissible,
  starts_at: row.starts_at.toISOString(),
  ends_at: row.ends_at ? row.ends_at.toISOString() : null,
  status_incident_url: row.status_incident_url,
});

export function registerF72BannerRoutes(app: FastifyInstance, pool: Pool): void {
  app.get('/api/v1/announcements', async (request, reply) => {
    const user = sessionUser(request);
    const r = await withUser(pool, user.id, (c) =>
      c.query<AnnouncementRow>('SELECT * FROM announcements_for_user()'),
    );
    return reply.send({ items: r.rows.map(announcementOf) });
  });

  app.post('/api/v1/announcements/:id/dismiss', async (request, reply) => {
    const id = idParam(request);
    const user = sessionUser(request);
    await definer(() =>
      withUser(pool, user.id, (c) => c.query('SELECT announcement_dismiss($1::uuid)', [id])),
    );
    return reply.status(204).send();
  });
}
