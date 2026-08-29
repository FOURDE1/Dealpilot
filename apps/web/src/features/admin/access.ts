/**
 * F-69 — what the console does with the identity probe's answer. Pure, so
 * the guard component stays a switch and this stays unit-testable.
 *
 *   404 / 403 (not mfa) → not staff: the console does not exist for this
 *        person (home).
 *   403 mfa_enrolment_required → walled until they enrol on /security.
 *   401 admin_reauth_required → the console session aged out: sign out and
 *        back in through the TOTP challenge.
 *   anything else (5xx, network, timeout) → an ERROR with a retry — a deploy
 *        blip must not eject a staffer to the tenant home (review).
 *   2xx with a live support session (F-71) → the console is a wall with the End.
 *   2xx → in.
 */
export type AdminAccess = 'pending' | 'denied' | 'mfa' | 'reauth' | 'error' | 'ok' | 'impersonating';

export interface AdminAccessState {
  pending: boolean;
  error?: { status?: number; errorCode?: string } | null;
  ok?: boolean;
  /** F-71: the probe carries the live session, if any. */
  impersonating?: boolean;
}

export function adminAccess(state: AdminAccessState): AdminAccess {
  if (state.pending) return 'pending';
  if (state.error) {
    const { status, errorCode } = state.error;
    // F-71: the gate's one-time "the support session just ended" is a refresh
    // cue, never a verdict on who you are — the next probe answers as the
    // plain staffer (RequirePlatform invalidates and refetches).
    if (status === 403 && errorCode === 'impersonation_ended') return 'pending';
    if (status === 403 && errorCode === 'mfa_enrolment_required') return 'mfa';
    if (status === 401) return 'reauth';
    if (status === 404 || status === 403) return 'denied';
    return 'error';
  }
  if (!state.ok) return 'denied';
  return state.impersonating ? 'impersonating' : 'ok';
}
