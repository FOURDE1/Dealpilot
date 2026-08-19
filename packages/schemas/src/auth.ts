import { z } from 'zod';
import { Email, IsoDateTime, Uuid } from './common.js';

/**
 * Session/user contract for the web app (A-05). Identity comes from Better
 * Auth (D-023); this is the shape `GET /api/v1/me` returns and what the web
 * shell's session probe consumes (H-03). Auth flows themselves (sign-up/in/out)
 * go through the Better Auth client SDK against `/api/auth/*`.
 */
export const MeResponse = z.object({
  user: z.object({
    id: Uuid,
    email: Email,
    name: z.string(),
  }),
  session: z.object({
    expires_at: IsoDateTime,
  }),
  /**
   * F-41 (FR-AUTH-006): whether this account HAS TOTP, and whether any of its
   * memberships' roles REQUIRE it (owner/gm/admin_office). The shell reads the
   * pair to decide between "offer enrolment" and "wall until enrolled" — the
   * distinction between a suggestion and a policy.
   */
  mfa: z.object({
    enabled: z.boolean(),
    required: z.boolean(),
  }),
});

export type MeResponseT = z.infer<typeof MeResponse>;
