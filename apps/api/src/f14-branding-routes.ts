import type { FastifyInstance } from 'fastify';
import { withTenant, withUser, type Pool } from '@dealpilot/db';
import {
  BRANDING_CONTENT_TYPES,
  BRANDING_SLOTS,
  brandingKey,
  MAX_BRANDING_BYTES,
  sha256,
  type BrandingSlot,
  type StorageDriver,
} from './storage.js';
import { formatOklch, parseColor, validateBrandingContrast } from '@dealpilot/core';
import { UpdateBrandingInput } from '@dealpilot/schemas';
import { AppError, notFound, parseOrThrow } from './errors.js';
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
  'font_family', 'radius', 'density', 'dark_mode',
] as const;

/**
 * Which brand a request is editing: the group's, or one rooftop's.
 *
 * A store-level row is the sub-brand case in section 3 — a group whose Kia
 * rooftop carries Kia's colours and whose used-car lot carries its own. The
 * resolution query has always PREFERRED a store row over the group row; without
 * this the table could hold one that no route could edit or publish, which is
 * worse than not supporting it at all.
 */
function scopeOf(request: { query: unknown }): string | null {
  const raw = (request.query as { store_id?: string } | undefined)?.store_id;
  return raw && raw.length > 0 ? raw : null;
}

const COLOR_COLUMNS = [
  'primary_color', 'accent_color', 'success_color',
  'warning_color', 'danger_color', 'info_color',
] as const;

export function registerF14Routes(app: FastifyInstance, pool: Pool, storage: StorageDriver): void {
  /**
   * What the SPA loads before first paint.
   *
   * Any member may read it — it is the skin of the app they are already inside,
   * and gating it behind a settings permission would mean the page renders
   * unbranded for everyone except the owner.
   */
  app.get('/api/v1/branding', async (request, reply) => {
    const user = sessionUser(request);
    // A caller with no organisation yet — most fresh sessions — is asking a
    // question that has a perfectly good answer: no brand applies to you, use
    // the platform's own. Answering 404 conflated that with "not found", and a
    // client can only read that as an error: react-query retried, the shell
    // re-rendered in a loop and raced an accessibility test (found by HUSSEIN
    // wiring the injection, worked around client-side; fixed at the source).
    const orgId = await brandingOrg(pool, user.id, (request.query as { organization_id?: string }).organization_id);
    if (!orgId) return reply.send(null);
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
    const storeId = scopeOf(request);
    const user = sessionUser(request);
    const row = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'organization:update');
      const r = await c.query<Record<string, unknown>>(
        `SELECT * FROM tenant_branding
         WHERE organization_id = $1 AND store_id IS NOT DISTINCT FROM $2 AND deleted_at IS NULL`,
        [orgId, storeId],
      );
      return r.rows[0] ?? null;
    });
    // A tenant who has never opened the editor has no draft row, and "load the
    // draft" is a question that should always resolve — the same shape as the
    // published read (CR-16, Hussein). null means "start from the platform
    // defaults", which are exported as BRANDING_DEFAULTS so the editor is not
    // holding a second copy of them.
    //
    // A foreign or unknown organisation is still a 404: requirePermission above
    // throws before this line, so the friendlier answer cannot leak existence.
    return reply.send(row);
  });

  /**
   * Save the draft. Creates the row on first edit, so a tenant never has to
   * "initialise branding" before they can change a colour.
   */
  app.put('/api/v1/organizations/:id/branding', async (request, reply) => {
    const orgId = idParam(request);
    const input = parseOrThrow(UpdateBrandingInput, request.body);
    const storeId = scopeOf(request);
    const user = sessionUser(request);

    const row = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'organization:update');
      if (storeId) await requireStoreInOrg(c, storeId);

      // Colours are normalised to OKLCH on the way IN, so the database never
      // holds two spellings of the same colour and the CHECK constraint means
      // what it says. The picker may send hex; storage is one form.
      const normalized: Record<string, unknown> = { ...input };
      for (const col of COLOR_COLUMNS) {
        const v = normalized[col];
        if (typeof v === 'string') normalized[col] = toOklch(v);
      }

      // The scope comes from the URL, never the body: a `store_id` sitting in a
      // payload beside a set of colours is a way to move a brand to a different
      // rooftop by accident.
      delete normalized['store_id'];
      const cols = BRANDING_COLUMNS.filter((k) => k !== 'store_id' && k in normalized);
      const existing = await c.query<{ id: string }>(
        `SELECT id FROM tenant_branding
         WHERE organization_id = $1 AND store_id IS NOT DISTINCT FROM $2 AND deleted_at IS NULL
         FOR UPDATE`,
        [orgId, storeId],
      );

      if (existing.rows.length === 0) {
        const insertCols = ['organization_id', 'store_id', ...cols];
        const r = await c.query<Record<string, unknown>>(
          `INSERT INTO tenant_branding (${insertCols.join(', ')})
           VALUES (${insertCols.map((_, i) => `$${i + 1}`).join(', ')})
           RETURNING *`,
          [orgId, storeId, ...cols.map((k) => normalized[k] ?? null)],
        );
        await recordEvent(c, {
          organizationId: orgId, storeId: null, actorUserId: user.id,
          entityType: 'tenant_branding', entityId: String(r.rows[0]!['id']),
          action: 'created', parentEntityType: 'organization', parentEntityId: orgId,
          changes: { scope: storeId ? 'store' : 'organization' },
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
   * Upload a brand asset — logo, favicon, email logo, login background.
   *
   * Raw bytes with a real content-type, the same shape as a scanned document,
   * behind the same storage driver. The allowlist is NOT the document one: a
   * signed bank contract must never be an SVG and a logo must never be a PDF,
   * and one shared list would have permitted both.
   */
  app.post(
    '/api/v1/organizations/:id/branding/assets/:slot',
    // Stop reading at the largest slot's ceiling instead of the parser's 20 MB:
    // the handler would reject anything above it anyway, and buffering first
    // lets one authenticated caller hold 19 MB per request that was never
    // going to be stored.
    { bodyLimit: MAX_BRANDING_BYTES },
    async (request, reply) => {
    const orgId = idParam(request);
    const slot = String((request.params as { slot?: string }).slot ?? '') as BrandingSlot;
    const spec = BRANDING_SLOTS[slot];
    if (!spec) {
      throw new AppError(404, 'unknown_slot', 'There is no such brand asset', [
        { path: 'slot', code: 'unknown_slot', message: slot || '(none)' },
      ]);
    }

    const storeId = scopeOf(request);
    const contentType = String(request.headers['content-type'] ?? '').split(';')[0]!.trim();
    const extension = BRANDING_CONTENT_TYPES[contentType];
    if (!extension) {
      throw new AppError(415, 'unsupported_media_type', 'A brand asset must be a PNG, JPEG or SVG', [
        { path: 'content-type', code: 'unsupported_media_type', message: contentType || '(none)' },
      ]);
    }
    // Email clients render SVG unreliably or not at all. Accepting one here
    // would produce a logo that looks right in the editor and is missing from
    // every email the dealership sends.
    if (spec.raster && extension === 'svg') {
      throw new AppError(415, 'raster_required', 'This asset must be a PNG or JPEG', [
        { path: 'content-type', code: 'raster_required', message: 'SVG does not render in email clients' },
      ]);
    }

    const body = request.body;
    if (!Buffer.isBuffer(body) || body.byteLength === 0) {
      throw new AppError(422, 'empty_file', 'The uploaded file is empty', [
        { path: 'body', code: 'empty_file', message: 'no bytes' },
      ]);
    }
    if (body.byteLength > spec.maxBytes) {
      throw new AppError(413, 'payload_too_large', 'That file is too large for this slot', [
        {
          path: 'body',
          code: 'payload_too_large',
          message: `${Math.round(body.byteLength / 1024)} KB; the limit is ${Math.round(spec.maxBytes / 1024)} KB`,
        },
      ]);
    }

    const user = sessionUser(request);
    const row = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'organization:update');
      if (storeId) await requireStoreInOrg(c, storeId);
      const existing = await c.query<{ id: string }>(
        `SELECT id FROM tenant_branding
         WHERE organization_id = $1 AND store_id IS NOT DISTINCT FROM $2 AND deleted_at IS NULL
         FOR UPDATE`,
        [orgId, storeId],
      );

      const key = brandingKey(orgId, slot, sha256(body), extension);
      // Stored before the row points at it: a key with no object behind it is a
      // logo that 404s on every page load.
      await storage.put(key, body, contentType);

      // Editing the brand puts it back to draft — an asset is an edit like any
      // other, so a new logo does not appear on the floor until publish.
      if (existing.rows.length === 0) {
        const r = await c.query<Record<string, unknown>>(
          `INSERT INTO tenant_branding (organization_id, store_id, ${spec.column})
           VALUES ($1, $2, $3) RETURNING *`,
          [orgId, storeId, key],
        );
        return r.rows[0]!;
      }
      const r = await c.query<Record<string, unknown>>(
        `UPDATE tenant_branding SET ${spec.column} = $2, status = 'draft' WHERE id = $1 RETURNING *`,
        [existing.rows[0]!.id, key],
      );
      await recordEvent(c, {
        organizationId: orgId, storeId: null, actorUserId: user.id,
        entityType: 'tenant_branding', entityId: String(existing.rows[0]!.id),
        action: 'updated', parentEntityType: 'organization', parentEntityId: orgId,
        changes: { [spec.column]: key },
      });
      return r.rows[0]!;
    });
    return reply.code(201).send(row);
    },
  );

  /**
   * Serve a brand asset.
   *
   * Locked down hard because this is tenant-supplied content served from the
   * app's own origin: an SVG is a document that can carry script, and a logo
   * that could run script would be a stored XSS in every tenant's header. The
   * CSP below allows nothing at all, `nosniff` stops a PNG being re-read as
   * HTML, and the sandbox strips script even if the browser is talked into
   * treating it as a document. Render these with `<img src>` — never inline the
   * SVG into the DOM, where none of these headers apply.
   */
  app.get('/api/v1/branding/assets/:slot', async (request, reply) => {
    const slot = String((request.params as { slot?: string }).slot ?? '') as BrandingSlot;
    const spec = BRANDING_SLOTS[slot];
    if (!spec) throw notFound();

    const user = sessionUser(request);
    const orgId = await soleOrg(pool, user.id, (request.query as { organization_id?: string }).organization_id);
    const key = await withTenant(pool, orgId, async (c) => {
      await requireMember(c, user.id);
      // From the PUBLISHED snapshot, not the draft column: an unpublished logo
      // must not appear in the app any more than an unpublished colour does.
      // Store override first, then the group brand — the same order the palette
      // resolves in, or a rooftop ends up with its own colours under the
      // group's logo.
      const r = await c.query<{ key: string | null }>(
        `SELECT published_snapshot ->> $3 AS key FROM tenant_branding
         WHERE organization_id = $1 AND deleted_at IS NULL AND published_snapshot IS NOT NULL
           AND (store_id = $2 OR store_id IS NULL)
         ORDER BY store_id NULLS LAST
         LIMIT 1`,
        [orgId, scopeOf(request), spec.column],
      );
      return r.rows[0]?.key ?? null;
    });
    if (!key) throw notFound();

    const body = await storage.get(key);
    const type = key.endsWith('.svg')
      ? 'image/svg+xml'
      : key.endsWith('.png')
        ? 'image/png'
        : 'image/jpeg';
    return reply
      .header('content-type', type)
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
      // Content-addressed keys: the bytes at a key never change, so this is
      // safe to cache hard, and a new logo is a new key.
      .header('cache-control', 'private, max-age=31536000, immutable')
      .send(body);
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
    const storeId = scopeOf(request);
    const user = sessionUser(request);

    const row = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'organization:update');
      const current = await c.query<Record<string, unknown>>(
        `SELECT * FROM tenant_branding
         WHERE organization_id = $1 AND store_id IS NOT DISTINCT FROM $2 AND deleted_at IS NULL
         FOR UPDATE`,
        [orgId, storeId],
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
        radius: b['radius'],
        density: b['density'],
        dark_mode: b['dark_mode'],
        palette: {
          fills: validated.fills,
          text: validated.text,
          foregrounds: validated.foregrounds,
          dark: validated.dark,
          hover: validated.hover,
          ring: validated.ring,
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

/**
 * The organisation whose brand applies to this caller, or null when none does.
 *
 * Deliberately NOT the throwing variant: for a read whose whole purpose is
 * "what should this app look like", every honest answer is a 200. Belonging to
 * no organisation, or to several without saying which, both mean "the
 * platform's own look" — not an error a client has to interpret.
 */
async function brandingOrg(pool: Pool, userId: string, requested?: string): Promise<string | null> {
  if (requested) return requested;
  return withUser(pool, userId, async (c) => {
    const r = await c.query<{ organization_id: string }>(
      `SELECT DISTINCT m.organization_id FROM memberships m
       JOIN organizations o ON o.id = m.organization_id AND o.deleted_at IS NULL
       WHERE m.status = 'active'`,
    );
    return r.rows.length === 1 ? r.rows[0]!.organization_id : null;
  });
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
