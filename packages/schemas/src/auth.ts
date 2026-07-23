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
});

export type MeResponseT = z.infer<typeof MeResponse>;
