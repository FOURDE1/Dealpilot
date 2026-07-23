import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import { AppLayout } from './layout.js';
import { RedirectIfAuthed, RequireAuth } from './guards.js';

const SignInPage = lazy(() =>
  import('../features/auth/sign-in-page.js').then((m) => ({ default: m.SignInPage })),
);
const SignUpPage = lazy(() =>
  import('../features/auth/sign-up-page.js').then((m) => ({ default: m.SignUpPage })),
);
const DashboardPage = lazy(() =>
  import('../features/dashboard/dashboard-page.js').then((m) => ({ default: m.DashboardPage })),
);

function RouteSkeleton() {
  return (
    <div className="p-6" aria-busy="true">
      <div className="h-7 w-56 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
    </div>
  );
}

const lazyPage = (page: ReactNodeLike) => <Suspense fallback={<RouteSkeleton />}>{page}</Suspense>;
type ReactNodeLike = Parameters<typeof Suspense>[0]['children'];

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <RedirectIfAuthed>{lazyPage(<SignInPage />)}</RedirectIfAuthed>,
  },
  {
    path: '/signup',
    element: <RedirectIfAuthed>{lazyPage(<SignUpPage />)}</RedirectIfAuthed>,
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: lazyPage(<DashboardPage />) },
      // Placeholder module routes land with their feature slices.
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
