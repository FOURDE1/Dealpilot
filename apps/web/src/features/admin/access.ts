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
 *   2xx → in.
 */
export type AdminAccess = 'pending' | 'denied' | 'mfa' | 'reauth' | 'error' | 'ok';

export interface AdminAccessState {
  pending: boolean;
  error?: { status?: number; errorCode?: string } | null;
  ok?: boolean;
}

export function adminAccess(state: AdminAccessState): AdminAccess {
  if (state.pending) return 'pending';
  if (state.error) {
    const { status, errorCode } = state.error;
    if (status === 403 && errorCode === 'mfa_enrolment_required') return 'mfa';
    if (status === 401) return 'reauth';
    if (status === 404 || status === 403) return 'denied';
    return 'error';
  }
  return state.ok ? 'ok' : 'denied';
}
