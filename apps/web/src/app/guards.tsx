import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useSession } from '../shared/auth/client.js';
import { queryClient } from '../shared/api/queryClient.js';
import { publishedBrandingOptions } from '../features/branding/api.js';

/** Builds the /login redirect target preserving where the user was headed. */
export function loginRedirect(pathname: string, search: string): string {
  const returnTo = `${pathname}${search}`;
  return returnTo === '/' ? '/login' : `/login?returnTo=${encodeURIComponent(returnTo)}`;
}

/** Reads a safe returnTo (same-origin path only) from a search string. */
export function safeReturnTo(search: string): string {
  const value = new URLSearchParams(search).get('returnTo') ?? '/';
  // Only same-origin absolute paths — no scheme-relative ("//evil") escapes.
  return value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

export function FullPageSkeleton() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background" aria-busy="true">
      <div className="h-8 w-40 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
    </div>
  );
}

/**
 * Session guard — UX only; the API + RLS enforce authorization server-side
 * (frontend-stack §3.2). Unauthenticated → /login with returnTo.
 *
 * F-75 (D-076): the tenant brand is prefetched here, in parallel with the
 * session check, so the shell's first frame is already branded (AppLayout
 * holds a skeleton while the answer is in flight). Never for `/admin` — the
 * console renders no tenant brand. On a cold load with no session the call
 * answers 401 and caches an error; after sign-in the data-less entry is stale
 * and refetches on mount; sign-out clears the cache.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { data: session, isPending } = useSession();
  const location = useLocation();
  const onConsole = location.pathname.startsWith('/admin');

  useEffect(() => {
    if (onConsole) return;
    void queryClient.prefetchQuery(publishedBrandingOptions());
  }, [onConsole]);

  if (isPending) return <FullPageSkeleton />;
  if (!session) return <Navigate to={loginRedirect(location.pathname, location.search)} replace />;
  return children;
}

/** Public-only wrapper: an authenticated user never sees the auth screens. */
export function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { data: session, isPending } = useSession();
  const location = useLocation();

  if (isPending) return <FullPageSkeleton />;
  if (session) return <Navigate to={safeReturnTo(location.search)} replace />;
  return children;
}
