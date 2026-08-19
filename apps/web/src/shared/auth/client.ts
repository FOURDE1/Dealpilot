import { createAuthClient } from 'better-auth/react';
import { twoFactorClient } from 'better-auth/client/plugins';

/**
 * Better Auth client against the A-05 API (identity + sessions only, D-025).
 * Same-origin in dev via the Vite proxy — cookies stay first-party; the
 * default basePath matches the server's `/api/auth`.
 *
 * twoFactorClient (F-41): when a 2FA-enabled account signs in, the server
 * answers with `twoFactorRedirect: true` INSTEAD of a session, and the sign-in
 * page routes to the challenge. No `onTwoFactorRedirect` here — the redirect is
 * handled where sign-in happens, so the flow reads top-to-bottom in one file.
 */
export const authClient = createAuthClient({
  plugins: [twoFactorClient()],
});

export const { signIn, signUp, signOut, useSession, twoFactor } = authClient;
