import type { FastifyInstance } from 'fastify';
import { withTenant, withUser, type Pool, type PoolClient } from '@dealpilot/db';
import {
  CloseConversationInput,
  ConversationListQuery,
  MessageListQuery,
  SendAgentMessageInput,
  TakeoverInput,
} from '@dealpilot/schemas';
import type { Emitter } from '@dealpilot/contracts';
import type { Carrier } from './carrier.js';
import type { Env } from './env.js';
import { deliverMessage } from './f30-deliver.js';
import { AppError, notFound, parseOrThrow } from './errors.js';
import { callerOrgIds, idParam, keysetPage, sessionUser } from './f01-routes.js';
import { requirePermission } from './permissions.js';
import { recordEvent } from './activity.js';
import { sendMessage } from './f19-send.js';

/**
 * F-21 the agent console (conversation-engine.md §9, api-design.md §6).
 *
 * The console is where a person picks up what the assistant put down, so the
 * only interesting question in this file is what a human is allowed to do that
 * the assistant is not. The answer is: nothing about compliance.
 *
 * An agent's reply goes through `sendMessage` — the same gate, the same
 * outbound guard, the same `send_decisions` row. A person typing the message
 * changes who is accountable for its content; it does not change whether the
 * recipient consented, whether they said STOP, or what time it is where they
 * live. CASL does not have an exemption for messages a human wrote.
 */

/** The conversation, if this caller's organisation has it. */
async function conversationOrg(pool: Pool, userId: string, conversationId: string): Promise<string> {
  return withUser(pool, userId, async (c) => {
    const r = await c.query<{ organization_id: string }>(
      `SELECT cv.organization_id
       FROM conversations cv
       JOIN memberships m ON m.organization_id = cv.organization_id AND m.status = 'active'
       WHERE cv.id = $1 AND cv.deleted_at IS NULL
       LIMIT 1`,
      [conversationId],
    );
    // A conversation in another organisation is a 404, not a 403: telling an
    // outsider that an id exists is itself a leak.
    if (r.rows.length === 0) throw notFound();
    return r.rows[0]!.organization_id;
  });
}

async function loadConversation(c: PoolClient, id: string): Promise<Record<string, unknown>> {
  const r = await c.query<Record<string, unknown>>(
    `SELECT * FROM conversations WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  if (r.rows.length === 0) throw notFound();
  return r.rows[0]!;
}

/**
 * Every emit in this file happens AFTER `withTenant` returns — that is, after
 * the transaction has committed. Emitting inside it would broadcast a message
 * that a later statement could still roll back, and a browser cannot un-see a
 * conversation it was told about.
 */
export function registerF21Routes(
  app: FastifyInstance,
  pool: Pool,
  emitter: Emitter,
  carrier: Carrier,
  env: Env,
): void {
  app.get('/api/v1/conversations', async (request, reply) => {
    const query = parseOrThrow(ConversationListQuery, request.query);
    const user = sessionUser(request);
    // Which organisation, resolved under the caller's own context — then the
    // page itself under the tenant's, because `requirePermission` reads the org
    // from the GUC and there is no GUC to read before this step.
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
      await requirePermission(c, user.id, 'conversation:read');
      let sql = `SELECT * FROM conversations WHERE organization_id = $1 AND deleted_at IS NULL`;
      const params: unknown[] = [orgId];
      if (query.store_id) {
        params.push(query.store_id);
        sql += ` AND store_id = $${params.length}`;
      }
      if (query.status) {
        params.push(query.status);
        sql += ` AND status = $${params.length}`;
      }
      if (query.assigned_agent_id) {
        params.push(query.assigned_agent_id);
        sql += ` AND assigned_agent_id = $${params.length}`;
      }
      return keysetPage(c, sql, params, query);
    });
    return reply.send(page);
  });

  app.get('/api/v1/conversations/:id', async (request, reply) => {
    const id = idParam(request);
    const user = sessionUser(request);
    const orgId = await conversationOrg(pool, user.id, id);
    const body = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'conversation:read');
      const conversation = await loadConversation(c, id);
      const analysis = await c.query<Record<string, unknown>>(
        `SELECT id, conversation_id, lead_id, analysis_type, sentiment, buying_signals,
                concerns, suggested_response, summary, score, score_reason, created_at
         FROM conversation_analysis
         WHERE conversation_id = $1
         -- By seq, not created_at: rows written in one transaction share now()
         -- to the microsecond and the id tiebreak is a random uuid (0035).
         ORDER BY seq DESC
         LIMIT 20`,
        [id],
      );
      return { conversation, analysis: analysis.rows };
    });
    return reply.send(body);
  });

  app.get('/api/v1/conversations/:id/messages', async (request, reply) => {
    const id = idParam(request);
    const query = parseOrThrow(MessageListQuery, request.query);
    const user = sessionUser(request);
    const orgId = await conversationOrg(pool, user.id, id);
    const page = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'conversation:read');
      return keysetPage(
        c,
        `SELECT * FROM messages WHERE conversation_id = $1`,
        [id],
        query,
      );
    });
    return reply.send(page);
  });

  /**
   * An agent replies.
   *
   * Returns 200 for a refusal on purpose. The request was well-formed and the
   * answer is "no, and here is what would change it" — an agent staring at a
   * red error learns nothing, while "they asked us to stop; only they can undo
   * it, by texting START" tells them exactly what happened and that there is
   * nothing to retry.
   */
  app.post('/api/v1/conversations/:id/messages', async (request, reply) => {
    const id = idParam(request);
    const input = parseOrThrow(SendAgentMessageInput, request.body);
    const user = sessionUser(request);
    const orgId = await conversationOrg(pool, user.id, id);

    const result = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'conversation:reply');
      const conversation = await loadConversation(c, id);
      if (conversation['status'] === 'closed') {
        throw new AppError(409, 'conversation_closed', 'That conversation is closed');
      }

      const outcome = await sendMessage(c, {
        organizationId: orgId,
        storeId: String(conversation['store_id']),
        conversationId: id,
        leadId: (conversation['lead_id'] as string | null) ?? null,
        // The destination comes from the conversation, never from the request.
        phoneE164: String(conversation['phone_e164']),
        body: input.body,
        senderType: 'agent',
        // A person answering a live thread is replying, not prospecting.
        messageClass: 'inbound_reply',
        scope: 'conversational',
        isSolicitation: false,
        nowUtc: new Date(),
      });

      if (outcome.kind === 'sent') {
        // Answering IS taking it. A thread with a human reply in it that still
        // says bot_active would put the assistant back on top of them.
        if (conversation['status'] !== 'agent_active') {
          await c.query(
            `UPDATE conversations
             SET status = 'agent_active',
                 assigned_agent_id = COALESCE(assigned_agent_id, $2)
             WHERE id = $1`,
            [id, user.id],
          );
        }
        const message = await c.query<Record<string, unknown>>(
          `SELECT * FROM messages WHERE id = $1`, [outcome.messageId],
        );
        return { kind: 'sent' as const, message: message.rows[0]! };
      }
      if (outcome.kind === 'blocked') {
        return { kind: 'blocked' as const, reason: outcome.reason, remedy: outcome.remedy };
      }
      if (outcome.kind === 'deferred') {
        return { kind: 'deferred' as const, reason: outcome.reason, run_at: outcome.runAt.toISOString() };
      }
      return {
        kind: 'unsafe' as const,
        violations: outcome.violations.map((v) => ({ kind: v.kind, matched: v.matched, reason: v.reason })),
      };
    });

    // Committed. Only now is there anything true to announce — or to send.
    if (result.kind === 'sent') {
      const m = result.message as Record<string, unknown>;

      // The carrier call happens here, outside the transaction, for the reason
      // in f30-deliver.ts: a message sent with no row is unrecoverable, a row
      // with nothing sent is merely wrong and fixable.
      const store = await withTenant(pool, orgId, async (c) => {
        const r = await c.query<{ sms_number: string | null; phone_e164: string }>(
          `SELECT s.sms_number, cv.phone_e164
           FROM conversations cv JOIN stores s ON s.id = cv.store_id
           WHERE cv.id = $1`,
          [id],
        );
        return r.rows[0] ?? null;
      });
      if (store?.sms_number) {
        await deliverMessage(pool, carrier, env, {
          organizationId: orgId,
          messageId: String(m['id']),
          to: store.phone_e164,
          from: store.sms_number,
          body: String(m['body']),
        });
      }
      emitter.emit(
        { kind: 'conversation', organizationId: orgId, conversationId: id },
        {
          type: 'message.created',
          organization_id: orgId,
          conversation_id: id,
          message_id: String(m['id']),
          direction: 'outbound',
          sender_type: 'agent',
          body: String(m['body']),
          created_at: new Date(String(m['created_at'])).toISOString(),
        },
      );
    }
    return reply.send(result);
  });

  app.post('/api/v1/conversations/:id/takeover', async (request, reply) => {
    const id = idParam(request);
    const input = parseOrThrow(TakeoverInput, request.body ?? {});
    const user = sessionUser(request);
    const orgId = await conversationOrg(pool, user.id, id);

    const row = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'conversation:reply');
      const prior = await loadConversation(c, id);
      if (prior['status'] === 'closed') {
        throw new AppError(409, 'conversation_closed', 'That conversation is closed');
      }
      const target = input.assigned_agent_id ?? user.id;
      // Same rule as the handoff: the agent must work here. RLS is what refuses
      // a stranger, since a foreign membership is invisible to this query.
      const member = await c.query(
        `SELECT 1 FROM memberships WHERE user_id = $1 AND status = 'active' LIMIT 1`,
        [target],
      );
      if (member.rows.length === 0) {
        throw new AppError(422, 'not_assignable', 'That person is not an active member here', [
          { path: 'assigned_agent_id', code: 'not_assignable', message: 'Not an active member of this organization' },
        ]);
      }

      const r = await c.query<Record<string, unknown>>(
        `UPDATE conversations
         SET status = 'agent_active', assigned_agent_id = $2,
             handed_off_at = COALESCE(handed_off_at, now())
         WHERE id = $1 AND deleted_at IS NULL
         RETURNING *`,
        [id, target],
      );
      await recordEvent(c, {
        organizationId: orgId,
        storeId: String(prior['store_id']),
        actorUserId: user.id,
        entityType: 'conversation',
        entityId: id,
        action: 'assigned',
        changes: {
          status: { from: prior['status'], to: 'agent_active' },
          assigned_agent_id: { from: prior['assigned_agent_id'] ?? null, to: target },
        },
      });
      return r.rows[0]!;
    });
    emitter.emit(
      { kind: 'conversation', organizationId: orgId, conversationId: id },
      {
        type: 'conversation.changed',
        organization_id: orgId,
        conversation_id: id,
        status: 'agent_active',
        assigned_agent_id: (row['assigned_agent_id'] as string | null) ?? null,
      },
    );
    return reply.send(row);
  });

  /**
   * Close it.
   *
   * Closing does NOT suppress anybody. A finished conversation is a finished
   * conversation; if the customer writes again the inbound router opens a new
   * one, because "we are done talking" is our view of it and not their consent
   * being withdrawn. Withdrawing consent is F-18's job and takes their word.
   */
  app.post('/api/v1/conversations/:id/close', async (request, reply) => {
    const id = idParam(request);
    const input = parseOrThrow(CloseConversationInput, request.body ?? {});
    const user = sessionUser(request);
    const orgId = await conversationOrg(pool, user.id, id);

    const row = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'conversation:reply');
      const prior = await loadConversation(c, id);
      const r = await c.query<Record<string, unknown>>(
        `UPDATE conversations
         SET status = 'closed', closed_at = COALESCE(closed_at, now())
         WHERE id = $1 AND deleted_at IS NULL
         RETURNING *`,
        [id],
      );
      await recordEvent(c, {
        organizationId: orgId,
        storeId: String(prior['store_id']),
        actorUserId: user.id,
        entityType: 'conversation',
        entityId: id,
        action: 'updated',
        changes: {
          status: { from: prior['status'], to: 'closed' },
          ...(input.reason ? { reason: input.reason } : {}),
        },
      });
      return r.rows[0]!;
    });
    emitter.emit(
      { kind: 'conversation', organizationId: orgId, conversationId: id },
      {
        type: 'conversation.changed',
        organization_id: orgId,
        conversation_id: id,
        status: 'closed',
        assigned_agent_id: (row['assigned_agent_id'] as string | null) ?? null,
      },
    );
    return reply.send(row);
  });
}
