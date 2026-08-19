import { withTenant, type Pool } from '@dealpilot/db';
import { REASSIGN_MAX_ATTEMPTS, type LeadReassignJobT } from '@dealpilot/contracts';
import { assignLeadToManager, cascadeAssignLead } from '@dealpilot/api/cascade';
import { notify } from '@dealpilot/api/notifications';
import type { PresenceStore } from '@dealpilot/api/presence';

/**
 * F-42.2 — the ten-minute reassignment ladder, fired (FR-LEAD-010, leads.md
 * §5.2, D-046).
 *
 * The job is a CLAIM CHECK, not an order: it says "at enqueue time, THIS
 * agent held THIS lead on attempt N". At fire time the database decides
 * whether that claim still stands — the lead may have changed hands, been
 * contacted, converted, or deleted, and in every one of those worlds the
 * right action is nothing. Verification-at-fire replaces cancellation
 * plumbing (D-046 #1), so no message-write path anywhere needs to know Redis
 * exists.
 *
 * When the claim stands: the lead is TAKEN AWAY (not shared) — the agent
 * lands in previous_agents with reason 'no_response', the unowned invariant
 * is restored, attempts increments — and the §7.3 funnel re-runs excluding
 * every previous agent, stamping 'reassignment'. The third strike goes
 * straight to the sales manager and the ladder ends there (D-046 #3).
 */

export interface LeadReassignDeps {
  pool: Pool;
  /** Arm the NEXT rung. The queue adds the ten-minute delay; not this module. */
  armNext: (job: LeadReassignJobT) => Promise<void>;
  /** F-43: the re-run respects who is online, same as any cascade. */
  presence?: PresenceStore;
}

export type LeadReassignResult =
  /** The claim no longer stands — assignment moved, lead gone or terminal. */
  | { outcome: 'obsolete' }
  /** A human answered the SLA. The ladder ends in the best way. */
  | { outcome: 'contacted' }
  /** Taken away and re-funnelled; the timer restarts on the new holder. */
  | { outcome: 'reassigned'; to: string; attempt: number }
  /** Third strike (or escalation mid-ladder): the manager owns it now. */
  | { outcome: 'escalated'; to: string; attempt: number }
  /** Nobody exists to give it to. Unassigned, loudly. */
  | { outcome: 'stranded'; attempt: number };

const TERMINAL_STATUSES = "('converted','lost','expired')";

export async function runLeadReassign(
  deps: LeadReassignDeps,
  job: LeadReassignJobT,
): Promise<LeadReassignResult> {
  return withTenant(deps.pool, job.organization_id, async (c) => {
    // FOR UPDATE: the ladder must not race a manual PATCH or a second fire —
    // whoever locks first decides, the other sees the changed row.
    const r = await c.query<{
      assigned_to: string | null;
      assigned_at: string | null;
      assignment_attempts: number;
      status: string;
    }>(
      `SELECT assigned_to, assigned_at, assignment_attempts, status
       FROM leads
       WHERE id = $1 AND deleted_at IS NULL AND status NOT IN ${TERMINAL_STATUSES}
       FOR UPDATE`,
      [job.lead_id],
    );
    const lead = r.rows[0];
    if (
      lead === undefined ||
      lead.assigned_to !== job.assigned_to ||
      lead.assignment_attempts !== job.attempt ||
      lead.assigned_at === null
    ) {
      return { outcome: 'obsolete' };
    }

    // The SLA asks for a HUMAN touch: an outbound message a member of staff
    // sent since this assignment began. The assistant's own sends keep the
    // conversation warm but do not discharge the agent's ten minutes.
    const contacted = await c.query(
      `SELECT 1 FROM messages msg
       JOIN conversations cv ON cv.id = msg.conversation_id
       WHERE cv.lead_id = $1
         AND msg.direction = 'outbound' AND msg.sender_type = 'agent'
         AND msg.created_at >= $2::timestamptz
       LIMIT 1`,
      [job.lead_id, lead.assigned_at],
    );
    if (contacted.rows.length > 0) return { outcome: 'contacted' };

    // Taken away. The previous_agents entry is the ledger FR-LEAD-010 names:
    // who had it, when they got it, when it was taken, and why.
    const attempt = job.attempt + 1;
    await c.query(
      `UPDATE leads
       SET previous_agents = previous_agents || jsonb_build_array(jsonb_build_object(
             'user_id', assigned_to, 'assigned_at', assigned_at,
             'reassigned_at', now(), 'reason', 'no_response')),
           assignment_attempts = $2,
           assigned_to = NULL, assigned_at = NULL, assignment_method = NULL,
           status = CASE WHEN status = 'assigned' THEN 'new' ELSE status END
       WHERE id = $1`,
      [job.lead_id, attempt],
    );

    // F-47: tell the agent it was taken (D-046's 'first agent notified') —
    // a lead that silently vanishes from a list teaches nobody anything.
    await notify(c, {
      organizationId: job.organization_id,
      userId: job.assigned_to,
      urgency: 'medium',
      titleKey: 'notif_lead_taken_back',
      params: { minutes: 10 },
      link: `/leads/${job.lead_id}`,
      entityType: 'lead',
      entityId: job.lead_id,
    });

    if (attempt >= REASSIGN_MAX_ATTEMPTS) {
      const manager = await assignLeadToManager(c, job.organization_id, job.lead_id, 'three_strikes');
      if (manager === null) return { outcome: 'stranded', attempt };
      // The ladder ends at the manager — no fresh timer (D-046 #3).
      return { outcome: 'escalated', to: manager, attempt };
    }

    const decision = await cascadeAssignLead(c, job.organization_id, job.lead_id, null, {
      method: 'reassignment',
      ...(deps.presence ? { presence: deps.presence } : {}),
    });
    if (decision.outcome === 'assigned') {
      await deps.armNext({
        organization_id: job.organization_id,
        lead_id: job.lead_id,
        assigned_to: decision.user_id,
        attempt,
      });
      return { outcome: 'reassigned', to: decision.user_id, attempt };
    }
    if (decision.outcome === 'escalated') {
      // The funnel itself ran out of agents mid-ladder and gave it to the
      // manager — same terminus as the third strike, reached early.
      return { outcome: 'escalated', to: decision.user_id, attempt };
    }
    // no_one (an org with no managers at all) or a race we lost.
    return decision.outcome === 'already_assigned'
      ? { outcome: 'obsolete' }
      : { outcome: 'stranded', attempt };
  });
}
