import { createHash, randomBytes } from 'node:crypto';

/**
 * The invitation token mechanism (F-12, D-035), shared by the tenant path
 * (`POST /api/v1/invitations`) and the platform path (F-70 provisioning and
 * the owner-seat reissue). ONE hash, ONE TTL, ONE link shape: the accept
 * screen and `invitation_accept()` (0021) resolve every invitation the same
 * way regardless of who issued it. The token itself is never stored — only
 * its SHA-256 — so a database read cannot be turned back into a working link.
 */

export const INVITE_TTL_DAYS = 7;

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/** 32 bytes: guessing one is not a thing anyone does twice. */
export const newToken = (): string => randomBytes(32).toString('base64url');

export function acceptUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/$/, '')}/invitations/${token}`;
}
