import type { FastifyInstance } from 'fastify';
import { withTenant, withUser, type Pool } from '@dealpilot/db';
import { formatOklch, parseColor, validateBrandingContrast } from '@dealpilot/core';
import { UpdateBrandingInput } from '@dealpilot/schemas';
import { notFound, parseOrThrow } from './errors.js';
import { idParam, requireMember, sessionUser } from './f01-routes.js';
import { requirePermission } from './permissions.js';
import { recordEvent } from './activity.js';

/**
 * F-14 white-label branding (white-labeling.md; ADR-018).
 *
 * A dealership group's own name, logo, colours, font and corner radius, from
 * one deployment. Three things this module holds to:
 *
 *  - the SPA is only ever handed a PUBLISHED row, so somebody trying colours at
 *    4pm on a Friday does not repaint the app for the whole sales floor;
 *  - contrast is decided HERE, not in the browser, because a client that can
 *    choose its own colours can choose unreadable ones, and the accessibility
 *    claim has to survive a hostile client;
 *  - the fixes are recorded with their numbers, so "why is my link darker than
 *    the colour I picked?" has an answer.
 */

/** The columns a PUT may write, in the order the table declares them. */
const BRANDING_COLUMNS = [
  'store_id', 'display_name', 'legal_name', 'support_email', 'support_phone',
  'sms_sender_name', 'ai_persona_name',
  'logo_light_key', 'logo_dark_key', 'favicon_key', 'email_logo_key', 'login_bg_key',
  'primary_color', 'accent_color', 'success_color', 'warning_color', 'danger_color', 'info_color',
  'font_family', 'font_woff2_key', 'font_woff2_bold_key',
  'radius', 'density', 'dark_mode',
] as const;

const COLOR_COLUMNS = [
  'primary_color', 'accent_color', 'success_color',
  'warning_color', 'danger_color', 'info_color',
] as const;

export function registerF14Routes(app: FastifyInstance, pool: Pool): void {
  /**
   * What the SPA loads before first paint.
   *
   * Any member may read it — it is the skin of the app they are already inside,
   * and gating it behind a settings permission would mean the page renders
   * unbranded for everyone except the owner.
   */
  app.get('/api/v1/branding', async (request, reply) => {
    const user = sessionUser(request);
    const orgId = await soleOrg(pool, user.id, (request.query as { organization_id?: string }).organization_id);
    const storeId = (request.query as { store_id?: string }).store_id ?? null;

    const row = await withTenant(pool, orgId, async (c) => {
      await requireMember(c, user.id);
      // Store override first, then the group brand (§3). A rooftop that has its
      // own sub-brand wins; everyone else inherits.
      // Keyed on the SNAPSHOT existing, not on status. `status='draft'` means
      // "has unpublished edits" — the last published brand stays live through
      // an edit, or opening the editor would strip the app's branding for
      // everyone on the floor until somebody pressed publish again.
      const r = await c.query<Record<string, unknown>>(
        `SELECT organization_id, store_id, published_snapshot, version
         FROM tenant_branding
         WHERE organization_id = $1 AND deleted_at IS NULL AND published_snapshot IS NOT NULL
           AND (store_id = $2 OR store_id IS NULL)
         ORDER BY store_id NULLS LAST
         LIMIT 1`,
        [orgId, storeId],
      );
      return r.rows[0] ?? null;
    });

    // No branding configured is not an error: the platform's own default theme
    // is a perfectly good answer, and 404 here would break first paint for
    // every tenant who has not opened the editor yet.
    if (!row) return reply.send(null);

    // Straight from the snapshot: the draft columns beside it are somebody's
    // work in progress and have no business reaching a browser.
    return reply.send({
      organization_id: row['organization_id'],
      store_id: row['store_id'],
      ...(row['published_snapshot'] as Record<string, unknown>),
      version: row['version'],
    });
  });

  /** The editor's view: the draft as it stands, published or not. */
  app.get('/api/v1/organizations/:id/branding', async (request, reply) => {
    const orgId = idParam(request);
    const user = sessionUser(request);
    const row = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'organization:update');
      const r = await c.query<Record<string, unknown>>(
        `SELECT * FROM tenant_branding
         WHERE organization_id = $1 AND store_id IS NULL AND deleted_at IS NULL`,
        [orgId],
      );
      return r.rows[0] ?? null;
    });
    if (!row) throw notFound();
    return reply.send(row);
  });

  /**
   * Save the draft. Creates the row on first edit, so a tenant never has to
   * "initialise branding" before they can change a colour.
   */
  app.put('/api/v1/organizations/:id/branding', async (request, reply) => {
    const orgId = idParam(request);
    const input = parseOrThrow(UpdateBrandingInput, request.body);
    const user = sessionUser(request);

    const row = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'organization:update');
      if (input.store_id) await requireStoreInOrg(c, input.store_id);

      // Colours are normalised to OKLCH on the way IN, so the database never
      // holds two spellings of the same colour and the CHECK constraint means
      // what it says. The picker may send hex; storage is one form.
      const normalized: Record<string, unknown> = { ...input };
      for (const col of COLOR_COLUMNS) {
        const v = normalized[col];
        if (typeof v === 'string') normalized[col] = toOklch(v);
      }

      const cols = BRANDING_COLUMNS.filter((k) => k in normalized);
      const existing = await c.query<{ id: string }>(
        `SELECT id FROM tenant_branding
         WHERE organization_id = $1 AND store_id IS NULL AND deleted_at IS NULL
         FOR UPDATE`,
        [orgId],
      );

      if (existing.rows.length === 0) {
        const insertCols = ['organization_id', ...cols];
        const r = await c.query<Record<string, unknown>>(
          `INSERT INTO tenant_branding (${insertCols.join(', ')})
           VALUES (${insertCols.map((_, i) => `$${i + 1}`).join(', ')})
           RETURNING *`,
          [orgId, ...cols.map((k) => normalized[k] ?? null)],
        );
        await recordEvent(c, {
          organizationId: orgId, storeId: null, actorUserId: user.id,
          entityType: 'tenant_branding', entityId: String(r.rows[0]!['id']),
          action: 'created', parentEntityType: 'organization', parentEntityId: orgId,
        });
        return r.rows[0]!;
      }

      // Editing a published brand puts it back into draft: the change is not
      // live until someone publishes it deliberately. Silently repainting the
      // app on every keystroke of the editor is exactly what draft/published
      // exists to prevent.
      const params: unknown[] = [existing.rows[0]!.id];
      const sets = cols.map((k) => {
        params.push(normalized[k] ?? null);
        return `${k} = $${params.length}`;
      });
      sets.push(`status = 'draft'`);
      const r = await c.query<Record<string, unknown>>(
        `UPDATE tenant_branding SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
        params,
      );
      await recordEvent(c, {
        organizationId: orgId, storeId: null, actorUserId: user.id,
        entityType: 'tenant_branding', entityId: String(existing.rows[0]!.id),
        action: 'updated', parentEntityType: 'organization', parentEntityId: orgId,
        changes: Object.fromEntries(cols.map((k) => [k, normalized[k] ?? null])),
      });
      return r.rows[0]!;
    });
    return reply.send(row);
  });

  /**
   * Publish: compute the palette, fix what is unreadable, make it live.
   *
   * The contrast work happens at publish rather than on every page load because
   * the answer cannot change between them — the same colours give the same
   * palette forever — and because a fix nobody can see is not a fix. Stored
   * once, shown on the confirmation, served from then on.
   */
  app.post('/api/v1/organizations/:id/branding/publish', async (request, reply) => {
    const orgId = idParam(request);
    const user = sessionUser(request);

    const row = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'organization:update');
      const current = await c.query<Record<string, unknown>>(
        `SELECT * FROM tenant_branding
         WHERE organization_id = $1 AND store_id IS NULL AND deleted_at IS NULL
         FOR UPDATE`,
        [orgId],
      );
      if (current.rows.length === 0) throw notFound();
      const b = current.rows[0]!;

      const validated = validateBrandingContrast({
        primary: String(b['primary_color']),
        accent: (b['accent_color'] as string | null) ?? null,
        success: (b['success_color'] as string | null) ?? null,
        warning: (b['warning_color'] as string | null) ?? null,
        danger: (b['danger_color'] as string | null) ?? null,
        info: (b['info_color'] as string | null) ?? null,
      });

      // Everything the SPA is allowed to see, frozen at this moment.
      const snapshot = {
        display_name: b['display_name'],
        logo_light_key: b['logo_light_key'],
        logo_dark_key: b['logo_dark_key'],
        favicon_key: b['favicon_key'],
        font_family: b['font_family'],
        font_woff2_key: b['font_woff2_key'],
        font_woff2_bold_key: b['font_woff2_bold_key'],
        radius: b['radius'],
        density: b['density'],
        dark_mode: b['dark_mode'],
        palette: {
          fills: validated.fills,
          text: validated.text,
          foregrounds: validated.foregrounds,
          dark: validated.dark,
        },
      };

      const r = await c.query<Record<string, unknown>>(
        `UPDATE tenant_branding
         SET status = 'published', published_snapshot = $2, contrast_adjustments = $3,
             version = version + 1, published_at = now()
         WHERE id = $1
         RETURNING *`,
        [b['id'], JSON.stringify(snapshot), JSON.stringify(validated.adjustments)],
      );
      await recordEvent(c, {
        organizationId: orgId, storeId: null, actorUserId: user.id,
        entityType: 'tenant_branding', entityId: String(b['id']),
        action: 'stage_changed',
        parentEntityType: 'organization', parentEntityId: orgId,
        changes: {
          status: { from: String(b['status']), to: 'published' },
          version: { from: Number(b['version']), to: Number(b['version']) + 1 },
          // The adjustments belong in the trail as well as the row: a tenant
          // asking why their colour changed is asking about a specific publish.
          contrast_adjustments: validated.adjustments.length,
        },
      });
      return r.rows[0]!;
    });
    return reply.send(row);
  });
}

/**
 * Normalise any accepted colour spelling to the stored OKLCH form.
 *
 * Hex in, OKLCH out; OKLCH in, OKLCH out. Done on the way IN so the database
 * never holds two spellings of one colour — otherwise `#3b82f6` and
 * `oklch(0.6 0.2 262)` are the same brand and the CHECK constraint, the
 * equality comparisons and the activity trail all disagree about it.
 */
function toOklch(value: string): string {
  return formatOklch(parseColor(value));
}

async function requireStoreInOrg(
  c: Parameters<typeof requireMember>[0],
  storeId: string,
): Promise<void> {
  const r = await c.query(`SELECT 1 FROM stores WHERE id = $1 AND deleted_at IS NULL`, [storeId]);
  if (r.rows.length === 0) throw notFound();
}

/** The caller's organisation, when they belong to exactly one (F-01 pattern). */
async function soleOrg(pool: Pool, userId: string, requested?: string): Promise<string> {
  if (requested) return requested;
  return withUser(pool, userId, async (c) => {
    const r = await c.query<{ organization_id: string }>(
      `SELECT DISTINCT m.organization_id FROM memberships m
       JOIN organizations o ON o.id = m.organization_id AND o.deleted_at IS NULL
       WHERE m.status = 'active'`,
    );
    if (r.rows.length !== 1) throw notFound();
    return r.rows[0]!.organization_id;
  });
}
