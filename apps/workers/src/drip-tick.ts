import { withTenant, type Pool } from '@dealpilot/db';
import { DripSteps } from '@dealpilot/schemas';
import { dripTickDecision, isPlatformPause, renderDripBody, type DripStep } from '@dealpilot/core';
import { sendMessage } from '@dealpilot/api/send';
import { deliverMessage } from '@dealpilot/api/deliver';
import { findOrCreateConversation } from '@dealpilot/api/inbound-router';
import type { Carrier } from '@dealpilot/api/carrier';
import type { Env } from '@dealpilot/api/env';

/**
 * F-61 — the hourly drip tick (automation-notifications.md §11.1).
 *
 * One scan, then one small transaction per enrollment. The scan runs through
 * `drip_due_enrollments()` — SECURITY DEFINER, ids only — because "which
 * tenants have work" is exactly the question a tenant-scoped connection
 * cannot ask; everything that READS content or WRITES anything happens under
 * withTenant, inside RLS, per organization.
 *
 * Every send passes the full compliance gate. The tick never overrides it:
 * a deferral (quiet hours, daily cap) simply leaves the step unsent for the
 * next tick — the hourly cadence IS the retry loop, so there is no second
 * scheduling mechanism to disagree with the first.
 */

export interface DripTickDeps {
  readonly pool: Pool;
  readonly carrier: Carrier;
  readonly env: Env;
  /** Injected so a test can drive the clock instead of waiting for day 7. */
  readonly now?: () => Date;
  /** Where a poison enrollment's error lands (the registrar's logger seam). */
  readonly warn?: (message: string, err: unknown) => void;
}

export interface DripTickSummary {
  scanned: number;
  sent: number;
  completed: number;
  expired: number;
  ended: number;
  waiting: number;
  skipped: number;
}

/**
 * How every gate refusal is classified. Exported and asserted to PARTITION
 * `BLOCKED_REASONS` exactly (drip-reasons.test.ts): union equal, pairwise
 * disjoint. A new reason added upstream without a decision here fails that
 * guard instead of silently inheriting whatever the fall-through happens to
 * do — which is how F-72's two kill-switch reasons would otherwise have
 * quietly become permanent expiries or permanent waits.
 */

/** Gate refusals that can never clear on their own — the ride ends now. */
export const OPTED_OUT_REASONS = new Set(['suppressed', 'internal_dnc', 'dncl_listed']);
export const BASIS_GONE_REASONS = new Set([
  'consent_absent',
  'consent_expired',
  'consent_revoked',
  'adad_no_express_consent',
]);
/** Conditions that clear by themselves — tomorrow is another day. */
export const WAITING_REASONS = new Set(['frequency_cap', 'ai_suspended', 'dncl_list_stale']);
/**
 * F-72 §5.3: a platform operator stopped sending. The ride WAITS — the
 * enrollment is untouched and resumes on the first tick after the switch
 * lifts. Ending it would punish a dealer for an outage on our side.
 *
 * Re-exported, never re-declared: `deferred-send` and `first-touch` reach the
 * same set through `isPlatformPause`, and a second copy here would be two
 * lists of the same two reasons with nothing between them — in the one
 * vocabulary whose entire purpose is that every queue consumer agrees.
 */
export { PLATFORM_PAUSE_REASONS } from '@dealpilot/core';

export async function runDripTick(deps: DripTickDeps): Promise<DripTickSummary> {
  const now = deps.now?.() ?? new Date();
  const summary: DripTickSummary = {
    scanned: 0,
    sent: 0,
    completed: 0,
    expired: 0,
    ended: 0,
    waiting: 0,
    skipped: 0,
  };

  // Ids only — the definer function exposes nothing else (0060).
  const due = await deps.pool.query<{ organization_id: string; enrollment_id: string }>(
    `SELECT organization_id, enrollment_id FROM drip_due_enrollments($1)`,
    [now],
  );
  summary.scanned = due.rows.length;

  for (const row of due.rows) {
    // One poison enrollment must not abort the hour for every other tenant —
    // its own transaction rolled back, it counts as skipped, the rest of the
    // scan proceeds. The failure is not masked: 'skipped' rises in the
    // summary the registrar logs, and the row comes back next tick.
    try {
      const outcome = await processEnrollment(deps, row.organization_id, row.enrollment_id, now);
      summary[outcome] += 1;
    } catch (err) {
      deps.warn?.(`drip enrollment ${row.enrollment_id} failed this tick`, err);
      summary.skipped += 1;
    }
  }
  return summary;
}

type EnrollmentOutcome = 'sent' | 'completed' | 'expired' | 'ended' | 'waiting' | 'skipped';

interface StagedDelivery {
  readonly messageId: string;
  readonly to: string;
  readonly from: string;
  readonly body: string;
  readonly enrollmentId: string;
}

async function processEnrollment(
  deps: DripTickDeps,
  organizationId: string,
  enrollmentId: string,
  now: Date,
): Promise<EnrollmentOutcome> {
  const result = await withTenant(
    deps.pool,
    organizationId,
    async (c): Promise<{ outcome: EnrollmentOutcome; delivery?: StagedDelivery }> => {
      // The lock: two overlapping ticks (a slow run lapped by the next hour)
      // must not both send step 3. SKIP LOCKED lets the second tick move on.
      const er = await c.query<{
        id: string;
        store_id: string | null;
        drip_sequence_id: string;
        lead_id: string;
        conversation_id: string | null;
        current_step: number;
        enrolled_at: Date;
        expires_at: Date;
        status: string;
      }>(
        `SELECT id, store_id, drip_sequence_id, lead_id, conversation_id,
              current_step, enrolled_at, expires_at, status
       FROM drip_enrollments WHERE id = $1 AND status = 'active'
       FOR UPDATE SKIP LOCKED`,
        [enrollmentId],
      );
      if (er.rows.length === 0) return { outcome: 'skipped' };
      const enrollment = er.rows[0]!;

      // Expiry FIRST, before anything that could bail: a ride whose sequence
      // was deactivated or whose steps no longer parse must still age out,
      // or it sits 'active' forever, hogs the scan budget hourly, and blocks
      // the one-live-ride index from ever enrolling this lead again.
      if (now.getTime() >= enrollment.expires_at.getTime()) {
        await c.query(`UPDATE drip_enrollments SET status = 'expired' WHERE id = $1`, [
          enrollment.id,
        ]);
        return { outcome: 'expired' };
      }

      const sr = await c.query<{ steps: unknown; scope: string; active: boolean }>(
        `SELECT steps, scope, active FROM drip_sequences WHERE id = $1`,
        [enrollment.drip_sequence_id],
      );
      const sequence = sr.rows[0];
      if (!sequence) return { outcome: 'skipped' };

      const parsedSteps = DripSteps.safeParse(sequence.steps);
      // Config this code cannot understand sends nothing. 'skipped' surfaces in
      // the tick summary the registrar logs, so a broken sequence is visible.
      if (!parsedSteps.success) return { outcome: 'skipped' };
      const steps: readonly DripStep[] = parsedSteps.data;

      const decision = dripTickDecision(
        {
          currentStep: enrollment.current_step,
          enrolledAt: enrollment.enrolled_at,
          expiresAt: enrollment.expires_at,
        },
        steps,
        now,
      );

      if (decision.kind === 'expire') {
        await c.query(`UPDATE drip_enrollments SET status = 'expired' WHERE id = $1`, [
          enrollment.id,
        ]);
        return { outcome: 'expired' };
      }
      if (decision.kind === 'complete') {
        await c.query(`UPDATE drip_enrollments SET status = 'completed' WHERE id = $1`, [
          enrollment.id,
        ]);
        return { outcome: 'completed' };
      }
      if (decision.kind === 'wait') return { outcome: 'waiting' };
      // A deactivated sequence sends nothing more; its rides keep aging
      // toward the expiry handled above.
      if (!sequence.active) return { outcome: 'waiting' };

      // The lead this is FOR. A converted lead ('won' lives on DEALS, not in
      // the lead vocabulary — 0004) is no longer a nurture target: the ride
      // ends as reactivated-by-outcome. Deleted leads end it too, because a
      // drip to an erased record is a drip to nobody.
      const lr = await c.query<{
        first_name: string | null;
        last_name: string | null;
        vehicle_interest: string | null;
        phone: string;
        assigned_to: string | null;
        status: string;
        store_id: string | null;
        deleted_at: Date | null;
        preferred_language: string | null;
      }>(
        `SELECT first_name, last_name, vehicle_interest, phone, assigned_to, status, store_id,
              deleted_at, preferred_language
       FROM leads WHERE id = $1`,
        [enrollment.lead_id],
      );
      const lead = lr.rows[0];
      if (!lead || lead.deleted_at) {
        await c.query(`UPDATE drip_enrollments SET status = 'expired' WHERE id = $1`, [
          enrollment.id,
        ]);
        return { outcome: 'expired' };
      }
      if (lead.status === 'converted') {
        await c.query(
          `UPDATE drip_enrollments SET status = 'reactivated', reactivated_at = now() WHERE id = $1`,
          [enrollment.id],
        );
        return { outcome: 'ended' };
      }

      // The thread — the ONE live conversation for this phone (the partial
      // unique index in 0031 makes that singular), found or created through
      // f23's own findOrCreateConversation: phone-keyed, never a closed or
      // deleted thread, ON CONFLICT-safe against a racing inbound. A closed
      // conversation stays closed — somebody decided that thread was
      // finished; the campaign starts a fresh one (f23's own rule).
      const language: 'fr' | 'en' = lead.preferred_language?.startsWith('en') ? 'en' : 'fr';
      const live = await c.query<{ id: string }>(
        `SELECT id FROM conversations
         WHERE organization_id = $1 AND phone_e164 = $2 AND channel = 'sms'
           AND status <> 'closed' AND deleted_at IS NULL`,
        [organizationId, lead.phone],
      );
      let convId = live.rows[0]?.id;
      if (!convId) {
        // Creating a thread needs a rooftop to speak AS. A central-queue lead
        // (store_id NULL, D-044) has none yet — the ride waits for
        // distribution, because conversations.store_id is NOT NULL by design.
        if (!lead.store_id) return { outcome: 'waiting' };
        const created = await findOrCreateConversation(
          c,
          {
            organizationId,
            storeId: lead.store_id,
            phoneE164: lead.phone,
            body: '',
            providerRef: `drip:${enrollment.id}:${enrollment.current_step}`,
          },
          { language },
        );
        convId = created.id;
      }
      const conv = (
        await c.query<{
          id: string;
          store_id: string;
          phone_e164: string;
          status: string;
          language: 'fr' | 'en';
          lead_id: string | null;
        }>(
          `SELECT id, store_id, phone_e164, status, language, lead_id
           FROM conversations WHERE id = $1`,
          [convId],
        )
      ).rows[0]!;

      // A person is in this thread right now. A robot interjecting mid-handoff
      // would talk over them — wait for the thread to settle.
      if (conv.status === 'agent_active' || conv.status === 'handed_off') {
        return { outcome: 'waiting' };
      }
      // The thread belongs to a DIFFERENT lead on this phone: the person is
      // already active under another record (duplicate enquiry), so nurturing
      // this one would double-text them. The ride ends as
      // reactivated-by-other-record, not as a wait that never resolves.
      if (conv.lead_id !== null && conv.lead_id !== enrollment.lead_id) {
        await c.query(
          `UPDATE drip_enrollments SET status = 'reactivated', reactivated_at = now() WHERE id = $1`,
          [enrollment.id],
        );
        return { outcome: 'ended' };
      }

      const storeId = conv.store_id;
      const store = (
        await c.query<{ name: string; phone: string | null; sms_number: string | null }>(
          `SELECT name, phone, sms_number FROM stores WHERE id = $1`,
          [storeId],
        )
      ).rows[0];
      // No carrier number, no send — staging a message that can never leave
      // would advance the ride while the customer hears nothing. The ride
      // waits for the tenant to provision the rooftop.
      if (!store?.sms_number) return { outcome: 'waiting' };
      const from = store.sms_number;

      // Crash recovery BEFORE composing anything new (F-59 discipline): a
      // staged drip whose carrier call never concluded (provider_ref NULL) is
      // redelivered — never a second row, and the step does not advance again.
      const stale = await c.query<{ id: string; body: string }>(
        `SELECT id, body FROM messages
         WHERE conversation_id = $1 AND direction = 'outbound' AND sender_type = 'drip'
           AND provider_ref IS NULL
         ORDER BY created_at LIMIT 1`,
        [conv.id],
      );
      if (stale.rows[0]) {
        return {
          outcome: 'sent',
          delivery: {
            messageId: stale.rows[0].id,
            to: conv.phone_e164,
            from,
            body: stale.rows[0].body,
            enrollmentId: enrollment.id,
          },
        };
      }

      const agent = lead.assigned_to
        ? await c.query<{ name: string }>(`SELECT name FROM "user" WHERE id = $1`, [
            lead.assigned_to,
          ])
        : null;
      const fields = {
        first_name: lead.first_name,
        last_name: lead.last_name,
        vehicle: lead.vehicle_interest,
        salesperson: agent?.rows[0]?.name ?? null,
        store_name: store.name,
        store_phone: store.phone ?? store.sms_number,
      };

      const request = (body: string) =>
        sendMessage(c, {
          organizationId,
          storeId,
          conversationId: conv.id,
          leadId: enrollment.lead_id,
          phoneE164: conv.phone_e164,
          body,
          senderType: 'drip',
          messageClass: 'drip',
          scope: sequence.scope === 'marketing' ? 'marketing' : 'conversational',
          isSolicitation: sequence.scope === 'marketing',
          nowUtc: now,
        } as const);

      let body = renderDripBody(decision.step, fields, conv.language);
      let sendOutcome = await request(body);
      if (sendOutcome.kind === 'unsafe') {
        // The guard refused the rendered body — almost always customer-typed
        // data riding a merge field ({{vehicle}} holding a URL, a name holding
        // an injection). One retry WITHOUT the customer-typed fields: the
        // tenant's template with only tenant-owned values. If THAT is unsafe,
        // the template itself is the problem and the ride cannot continue.
        body = renderDripBody(
          decision.step,
          { store_name: store.name, store_phone: store.phone ?? store.sms_number },
          conv.language,
        );
        sendOutcome = await request(body);
      }

      if (sendOutcome.kind === 'sent') {
        await c.query(
          `UPDATE drip_enrollments
         SET current_step = current_step + 1, last_message_sent_at = $2
         WHERE id = $1`,
          [enrollment.id, now],
        );
        // The thread is now a campaign thread — the status f23 watches to turn
        // a reply into a reactivation.
        if (conv.status !== 'drip_active') {
          await c.query(`UPDATE conversations SET status = 'drip_active' WHERE id = $1`, [conv.id]);
        }
        return {
          outcome: 'sent',
          delivery: {
            messageId: sendOutcome.messageId,
            to: conv.phone_e164,
            from,
            body,
            enrollmentId: enrollment.id,
          },
        };
      }

      if (sendOutcome.kind === 'blocked') {
        if (OPTED_OUT_REASONS.has(sendOutcome.reason)) {
          await c.query(
            `UPDATE drip_enrollments SET status = 'opted_out', opted_out_at = now() WHERE id = $1`,
            [enrollment.id],
          );
          return { outcome: 'ended' };
        }
        if (BASIS_GONE_REASONS.has(sendOutcome.reason)) {
          await c.query(`UPDATE drip_enrollments SET status = 'expired' WHERE id = $1`, [
            enrollment.id,
          ]);
          return { outcome: 'ended' };
        }
        if (isPlatformPause(sendOutcome.reason)) {
          // Untouched on purpose: the next tick after the switch lifts sends it.
          return { outcome: 'waiting' };
        }
        if (WAITING_REASONS.has(sendOutcome.reason)) {
          return { outcome: 'waiting' };
        }
        // Unclassified. Waiting is the safe default, but a silent default is
        // how a new refusal reason stops a whole campaign without anyone
        // noticing, so say so where production can see it.
        deps.warn?.(`unclassified blocked reason: ${sendOutcome.reason}`, sendOutcome);
        return { outcome: 'waiting' };
      }

      if (sendOutcome.kind === 'unsafe') {
        // The content guard refused a tenant-authored template. Deterministic:
        // the same body fails every hour forever, so the ride cannot continue.
        // The send_decisions/guard trail records what was refused and why.
        await c.query(`UPDATE drip_enrollments SET status = 'expired' WHERE id = $1`, [
          enrollment.id,
        ]);
        return { outcome: 'ended' };
      }

      // deferred — quiet hours. The step stays current; the next tick lands
      // inside the window eventually. No DeferredSendJob on purpose: two
      // schedulers for one message means two chances to send it.
      return { outcome: 'waiting' };
    },
  );

  // Post-commit, crash-isolated from the state above (F-59 discipline): the
  // enrollment already advanced, so a carrier hiccup here can never double-
  // advance or double-send. A crash or retryable rejection leaves
  // provider_ref NULL and the NEXT tick's stale-message check redelivers; a
  // permanent rejection ends the ride — the number cannot receive it, and
  // retrying an invalid destination hourly for ninety days helps nobody.
  if (result.delivery) {
    const delivered = await deliverMessage(deps.pool, deps.carrier, deps.env, {
      organizationId,
      messageId: result.delivery.messageId,
      to: result.delivery.to,
      from: result.delivery.from,
      body: result.delivery.body,
    });
    // F-72: the belt refused this at the wire. Nothing left, so the tick must
    // not count it in `sent`. The row keeps provider_ref NULL, so the next
    // tick's stale-message check redelivers it once the switch lifts.
    if (delivered.kind === 'rejected' && delivered.code === 'platform_paused') return 'waiting';
    if (delivered.kind === 'rejected' && !delivered.retryable) {
      const rideId = result.delivery.enrollmentId;
      await withTenant(deps.pool, organizationId, async (c) => {
        await c.query(
          `UPDATE drip_enrollments SET status = 'expired' WHERE id = $1 AND status = 'active'`,
          [rideId],
        );
      });
    }
  }
  return result.outcome;
}
