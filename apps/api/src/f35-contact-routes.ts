import type { FastifyInstance } from 'fastify';
import { withTenant, withUser, type Pool, type PoolClient } from '@dealpilot/db';
import {
  ContactListQuery, CreateContactInput, MergeContactsInput, UpdateContactInput,
} from '@dealpilot/schemas';
import { mergeContacts } from './f36-deal-parties.js';
import { AppError, notFound, parseOrThrow } from './errors.js';
import { callerOrgIds, idParam, keysetPage, sessionUser } from './f01-routes.js';
import { requirePermission } from './permissions.js';
import { recordEvent } from './activity.js';

/**
 * F-35 contacts — the customer master (FR-CON).
 *
 * Reuses `lead:*` permissions rather than inventing `contact:*`. A contact and
 * a lead are the same person at different moments, and anybody trusted to edit
 * one is trusted to edit the other; a separate permission would be a screen an
 * owner has to configure to describe a distinction that does not exist.
 */

const COLUMNS =
  'organization_id, store_id, first_name, last_name, email, phone, phone_alt, ' +
  'address_line1, city, province, postal_code, employer, preferred_language, ' +
  'preferred_contact, tags, source, referred_by_contact_id, consent_marketing, ' +
  'consent_marketing_at, customer_since';

/** Which organisation owns this contact, resolved before any tenant context. */
async function contactOrg(pool: Pool, userId: string, contactId: string): Promise<string> {
  return withUser(pool, userId, async (c) => {
    const r = await c.query<{ organization_id: string }>(
      `SELECT ct.organization_id
       FROM contacts ct
       JOIN memberships m ON m.organization_id = ct.organization_id AND m.status = 'active'
       WHERE ct.id = $1 AND ct.deleted_at IS NULL
       LIMIT 1`,
      [contactId],
    );
    if (r.rows.length === 0) throw notFound();
    return r.rows[0]!.organization_id;
  });
}

/**
 * Anybody already on file with this phone or email (FR-CON-003).
 *
 * Reported, never enforced. Two people at one address genuinely share a phone,
 * and refusing the second would send a salesperson to invent a number — which
 * is worse than a duplicate, because it is a duplicate nobody can find again.
 */
async function findDuplicates(
  c: PoolClient,
  orgId: string,
  phone: string | undefined,
  email: string | undefined,
): Promise<{ contact: Record<string, unknown>; matched_on: string[] }[]> {
  if (!phone && !email) return [];
  const r = await c.query<Record<string, unknown>>(
    `SELECT * FROM contacts
     WHERE organization_id = $1 AND deleted_at IS NULL
       AND (($2::text IS NOT NULL AND phone = $2)
         OR ($3::text IS NOT NULL AND lower(email) = lower($3)))
     LIMIT 5`,
    [orgId, phone ?? null, email ?? null],
  );
  return r.rows.map((row) => ({
    contact: row,
    matched_on: [
      ...(phone && row['phone'] === phone ? ['phone'] : []),
      ...(email && String(row['email'] ?? '').toLowerCase() === email.toLowerCase() ? ['email'] : []),
    ],
  }));
}

export function registerF35Routes(app: FastifyInstance, pool: Pool): void {
  app.post('/api/v1/contacts', async (request, reply) => {
    const input = parseOrThrow(CreateContactInput, request.body);
    const user = sessionUser(request);

    const created = await withTenant(pool, input.organization_id, async (c) => {
      await requirePermission(c, user.id, 'lead:create');

      const duplicates = await findDuplicates(c, input.organization_id, input.phone, input.email);

      const values = [
        input.organization_id, input.store_id ?? null, input.first_name ?? null,
        input.last_name ?? null, input.email ?? null, input.phone ?? null,
        input.phone_alt ?? null, input.address_line1 ?? null, input.city ?? null,
        input.province ?? null, input.postal_code ?? null, input.employer ?? null,
        input.preferred_language, input.preferred_contact, input.tags ?? [],
        input.source ?? null, input.referred_by_contact_id ?? null,
        input.consent_marketing,
        // The CHECK requires the date and the flag to agree, so it is derived
        // here rather than accepted — a client sending one without the other
        // would get a constraint violation instead of a validation message.
        input.consent_marketing ? new Date().toISOString() : null,
        null,
      ];
      const r = await c.query<Record<string, unknown>>(
        `INSERT INTO contacts (${COLUMNS})
         VALUES (${values.map((_, i) => `$${i + 1}`).join(',')})
         RETURNING *`,
        values,
      );
      const contact = r.rows[0]!;

      await recordEvent(c, {
        organizationId: input.organization_id,
        storeId: input.store_id ?? null,
        actorUserId: user.id,
        entityType: 'contact',
        entityId: String(contact['id']),
        action: 'created',
        changes: { source: input.source ?? null, duplicates: duplicates.length },
      });

      return { contact, duplicates };
    });
    return reply.status(201).send(created);
  });

  app.get('/api/v1/contacts', async (request, reply) => {
    const query = parseOrThrow(ContactListQuery, request.query);
    const user = sessionUser(request);

    const orgId = await withUser(pool, user.id, async (c) => {
      if (query.organization_id) {
        const member = await c.query(
          `SELECT 1 FROM memberships m
           JOIN organizations o ON o.id = m.organization_id AND o.deleted_at IS NULL
           WHERE m.organization_id = $1 AND m.status = 'active' LIMIT 1`,
          [query.organization_id],
        );
        if (member.rows.length === 0) throw notFound();
        return query.organization_id;
      }
      const orgs = await callerOrgIds(c);
      if (orgs.length === 0) return null;
      if (orgs.length > 1) {
        throw new AppError(400, 'organization_required', 'Pass organization_id — you belong to several organizations');
      }
      return orgs[0]!;
    });
    if (!orgId) return reply.send({ items: [], next_cursor: null });

    const page = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'lead:update');
      let sql = `SELECT * FROM contacts WHERE organization_id = $1 AND deleted_at IS NULL`;
      const params: unknown[] = [orgId];
      if (query.store_id) {
        params.push(query.store_id);
        sql += ` AND store_id = $${params.length}`;
      }
      if (query.q) {
        // Weighted vector: name beats email/phone beats city (FR-CON-004).
        // `plainto_tsquery` rather than `to_tsquery` because the input is a
        // person typing a name, not someone writing query syntax.
        params.push(query.q);
        sql += ` AND search_vector @@ plainto_tsquery('simple', $${params.length})`;
      }
      return keysetPage(c, sql, params, query);
    });
    return reply.send(page);
  });

  /**
   * Fold a duplicate into the survivor (FR-CON-003).
   *
   * Registered before `/:id` reads for clarity only — Fastify matches the
   * static segment first regardless.
   *
   * `lead:delete` rather than `lead:update`, because this is not an edit. One
   * of these two customer records stops existing, its deals move, and there is
   * no unmerge. The permission should be the one an owner grants deliberately.
   */
  app.post('/api/v1/contacts/merge', async (request, reply) => {
    const input = parseOrThrow(MergeContactsInput, request.body);
    const user = sessionUser(request);
    // Both must be reachable by this caller BEFORE anything moves; deriving the
    // org from the keeper alone would let a caller name somebody else's record
    // as the loser and have its deals walk into their tenant.
    const keepOrg = await contactOrg(pool, user.id, input.keep_id);
    const mergeOrg = await contactOrg(pool, user.id, input.merge_id);
    if (keepOrg !== mergeOrg) {
      throw new AppError(
        422, 'cross_org_merge',
        'Those customers belong to different organisations.',
        [{ path: 'merge_id', code: 'cross_org_merge', message: 'Customers can only be merged within one organisation' }],
      );
    }

    const result = await withTenant(pool, keepOrg, async (c) => {
      await requirePermission(c, user.id, 'lead:delete');
      const merged = await mergeContacts(c, {
        organizationId: keepOrg,
        keepId: input.keep_id,
        mergeId: input.merge_id,
      });
      await recordEvent(c, {
        organizationId: keepOrg,
        storeId: null,
        actorUserId: user.id,
        entityType: 'contact',
        entityId: input.keep_id,
        action: 'merged',
        changes: { merged_id: { to: input.merge_id }, moved: { to: merged.moved } },
      });
      return merged;
    });
    return reply.send(result);
  });

  app.get('/api/v1/contacts/:id', async (request, reply) => {
    const id = idParam(request);
    const user = sessionUser(request);
    const orgId = await contactOrg(pool, user.id, id);
    const contact = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'lead:update');
      const r = await c.query<Record<string, unknown>>(
        `SELECT * FROM contacts WHERE id = $1 AND deleted_at IS NULL`, [id],
      );
      if (r.rows.length === 0) throw notFound();
      return r.rows[0]!;
    });
    return reply.send(contact);
  });

  app.patch('/api/v1/contacts/:id', async (request, reply) => {
    const id = idParam(request);
    const input = parseOrThrow(UpdateContactInput, request.body);
    const user = sessionUser(request);
    const orgId = await contactOrg(pool, user.id, id);

    const contact = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'lead:update');
      const prior = await c.query<Record<string, unknown>>(
        `SELECT * FROM contacts WHERE id = $1 AND deleted_at IS NULL`, [id],
      );
      if (prior.rows.length === 0) throw notFound();

      const fields = Object.entries(input);
      if (fields.length === 0) return prior.rows[0]!;

      const params: unknown[] = [id];
      const sets = fields.map(([k, v]) => {
        params.push(v);
        return `${k} = $${params.length}`;
      });
      // The flag and its date move together, or the CHECK refuses the row.
      if (input.consent_marketing !== undefined) {
        params.push(input.consent_marketing ? new Date().toISOString() : null);
        sets.push(`consent_marketing_at = $${params.length}`);
      }
      const r = await c.query<Record<string, unknown>>(
        `UPDATE contacts SET ${sets.join(', ')} WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
        params,
      );
      if (r.rows.length === 0) throw notFound();

      await recordEvent(c, {
        organizationId: orgId,
        storeId: (r.rows[0]!['store_id'] as string | null) ?? null,
        actorUserId: user.id,
        entityType: 'contact',
        entityId: id,
        action: 'updated',
        changes: Object.fromEntries(fields.map(([k]) => [k, { to: input[k as keyof typeof input] }])),
      });
      return r.rows[0]!;
    });
    return reply.send(contact);
  });
}
