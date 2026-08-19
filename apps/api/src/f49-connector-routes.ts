import type { FastifyInstance } from 'fastify';
import { withTenant, withUser, type Pool, type PoolClient } from '@dealpilot/db';
import { ConnectorListQuery, CreateConnectorInput, UpdateConnectorInput } from '@dealpilot/schemas';
import { findConnector, type ConnectorDefinition } from '@dealpilot/core';
import { AppError, notFound, parseOrThrow } from './errors.js';
import { requirePermission } from './permissions.js';
import { recordEvent } from './activity.js';
import { idParam, keysetPage, requireMember, sessionUser } from './f01-routes.js';

/**
 * F-49 — tenant connectors (FR-LEAD-019, leads.md §2.3, D-053).
 *
 * "Adding a new lead provider means registering a connector + mapping — no
 * code change, no deploy." The rows here ARE that registration; the webhook
 * resolves a key against them first and falls back to the built-in presets.
 * Gated by intake_key:manage both ways — a connector shapes what enters the
 * front door, which is exactly the authority that mints the door's keys.
 */

interface ConnectorRow {
  source_key: string;
  type: 'json_webhook' | 'adf_xml';
  default_source: string;
  field_map: Record<string, string[]>;
  consent: {
    checkbox_path?: string;
    wording_path?: string;
    grants: { consent_type: string; channels: string[]; scopes: string[] };
  } | null;
  dedupe_fields: string[];
  label: string;
}

/**
 * The webhook's resolution: a tenant's ACTIVE row wins over the built-in of
 * the same key; an inactive or unknown key falls back to the built-ins, and
 * past them to website_form (the caller's existing fallback).
 */
export async function resolveConnector(
  c: PoolClient,
  organizationId: string,
  key: string,
): Promise<ConnectorDefinition | null> {
  const r = await c.query<ConnectorRow>(
    `SELECT source_key, type, default_source, field_map, consent, dedupe_fields, label
     FROM tenant_connectors
     WHERE organization_id = $1 AND source_key = $2 AND is_active`,
    [organizationId, key],
  );
  const row = r.rows[0];
  if (row === undefined) return findConnector(key);
  return {
    key: row.source_key,
    label: row.label,
    source: row.default_source,
    fieldMap: row.field_map as ConnectorDefinition['fieldMap'],
    ...(row.consent
      ? {
          consent: {
            ...(row.consent.checkbox_path ? { checkboxPath: row.consent.checkbox_path } : {}),
            ...(row.consent.wording_path ? { wordingPath: row.consent.wording_path } : {}),
            grants: {
              consentType: row.consent.grants.consent_type,
              channels: row.consent.grants.channels,
              scopes: row.consent.grants.scopes,
            },
          } as ConnectorDefinition['consent'],
        }
      : {}),
    dedupeFields: row.dedupe_fields as ConnectorDefinition['dedupeFields'],
  };
}

/** A key an intake credential may point at: a tenant row or a built-in. */
export async function connectorKeyExists(
  c: PoolClient,
  organizationId: string,
  key: string,
): Promise<boolean> {
  if (findConnector(key) !== null) return true;
  const r = await c.query(
    `SELECT 1 FROM tenant_connectors
     WHERE organization_id = $1 AND source_key = $2 AND is_active`,
    [organizationId, key],
  );
  return r.rows.length > 0;
}

async function connectorOrg(pool: Pool, userId: string, id: string): Promise<string> {
  return withUser(pool, userId, async (c) => {
    const r = await c.query<{ organization_id: string }>(
      `SELECT organization_id FROM tenant_connectors WHERE id = $1`,
      [id],
    );
    if (r.rows.length === 0) throw notFound();
    return r.rows[0]!.organization_id;
  });
}

export function registerF49Routes(app: FastifyInstance, pool: Pool): void {
  app.post('/api/v1/connectors', async (request, reply) => {
    const input = parseOrThrow(CreateConnectorInput, request.body);
    const user = sessionUser(request);
    // A tenant row shadowing a built-in preset would silently change every
    // existing key that names it — refuse the collision by name.
    if (findConnector(input.source_key) !== null) {
      throw new AppError(422, 'validation_failed', 'That key belongs to a built-in connector', [
        { path: 'source_key', code: 'reserved_key', message: input.source_key },
      ]);
    }
    const row = await withTenant(pool, input.organization_id, async (c) => {
      await requirePermission(c, user.id, 'intake_key:manage');
      const r = await c.query<Record<string, unknown>>(
        `INSERT INTO tenant_connectors
           (organization_id, source_key, label, type, default_source, field_map, consent, dedupe_fields)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          input.organization_id, input.source_key, input.label, input.type, input.default_source,
          JSON.stringify(input.field_map), input.consent ? JSON.stringify(input.consent) : null,
          input.dedupe_fields,
        ],
      );
      await recordEvent(c, {
        organizationId: input.organization_id,
        actorUserId: user.id,
        entityType: 'intake_key',
        entityId: String(r.rows[0]!['id']),
        action: 'created',
        changes: { connector: input.source_key, type: input.type },
      });
      return r.rows[0]!;
    });
    return reply.status(201).send(row);
  });

  app.get('/api/v1/connectors', async (request, reply) => {
    const query = parseOrThrow(ConnectorListQuery, request.query);
    const user = sessionUser(request);
    const orgId = query.organization_id;
    if (!orgId) {
      throw new AppError(400, 'organization_required', 'Pass organization_id', []);
    }
    const page = await withTenant(pool, orgId, async (c) => {
      await requireMember(c, user.id);
      return keysetPage(
        c,
        `SELECT * FROM tenant_connectors WHERE organization_id = $1`,
        [orgId],
        query,
      );
    });
    return reply.send(page);
  });

  app.patch('/api/v1/connectors/:id', async (request, reply) => {
    const id = idParam(request);
    const input = parseOrThrow(UpdateConnectorInput, request.body);
    const user = sessionUser(request);
    const orgId = await connectorOrg(pool, user.id, id);
    const row = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'intake_key:manage');
      // Belt-and-braces at the SINK (house pattern): schema-bounded keys,
      // re-bounded where they reach identifier position.
      const PATCHABLE = new Set(['label', 'default_source', 'field_map', 'consent', 'dedupe_fields', 'is_active']);
      const sets: string[] = [];
      const params: unknown[] = [id];
      for (const [key, value] of Object.entries(input)) {
        if (value === undefined) continue;
        if (!PATCHABLE.has(key)) throw new Error(`unpatchable column reached the SQL sink: ${key}`);
        params.push(key === 'field_map' || key === 'consent' ? JSON.stringify(value) : value);
        sets.push(`${key} = $${params.length}`);
      }
      const r = await c.query<Record<string, unknown>>(
        `UPDATE tenant_connectors SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
        params,
      );
      if (r.rows.length === 0) throw notFound();
      return r.rows[0]!;
    });
    return reply.send(row);
  });

  app.delete('/api/v1/connectors/:id', async (request, reply) => {
    const id = idParam(request);
    const user = sessionUser(request);
    const orgId = await connectorOrg(pool, user.id, id);
    await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'intake_key:manage');
      // A connector some key still points at must not vanish under it — the
      // key would silently fall back to website_form's mapping.
      const inUse = await c.query(
        `SELECT 1 FROM intake_keys
         WHERE connector_key = (SELECT source_key FROM tenant_connectors WHERE id = $1)
           AND revoked_at IS NULL AND active LIMIT 1`,
        [id],
      );
      if (inUse.rows.length > 0) {
        throw new AppError(409, 'connector_in_use', 'An active intake key still uses this connector', [
          { path: 'id', code: 'connector_in_use', message: 'Revoke the key first, or deactivate the connector instead' },
        ]);
      }
      const r = await c.query(`DELETE FROM tenant_connectors WHERE id = $1`, [id]);
      if (r.rowCount === 0) throw notFound();
    });
    return reply.status(204).send();
  });
}
