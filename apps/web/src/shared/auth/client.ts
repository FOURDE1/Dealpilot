import { createAuthClient } from 'better-auth/react';

/**
 * Better Auth client against the A-05 API (identity + sessions only, D-025).
 * Same-origin in dev via the Vite proxy — cookies stay first-party; the
 * default basePath matches the server's `/api/auth`.
 */
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession } = authClient;
