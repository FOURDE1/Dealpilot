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
const OrganizationsPage = lazy(() =>
  import('../features/organizations/organizations-page.js').then((m) => ({ default: m.OrganizationsPage })),
);
const OrganizationNewPage = lazy(() =>
  import('../features/organizations/organization-new-page.js').then((m) => ({ default: m.OrganizationNewPage })),
);
const OrganizationDetailPage = lazy(() =>
  import('../features/organizations/organization-detail-page.js').then((m) => ({ default: m.OrganizationDetailPage })),
);
const StoreFormPage = lazy(() =>
  import('../features/organizations/store-form-page.js').then((m) => ({ default: m.StoreFormPage })),
);
const LeadsPage = lazy(() =>
  import('../features/leads/leads-page.js').then((m) => ({ default: m.LeadsPage })),
);
const LeadNewPage = lazy(() =>
  import('../features/leads/lead-new-page.js').then((m) => ({ default: m.LeadNewPage })),
);
const LeadDetailPage = lazy(() =>
  import('../features/leads/lead-detail-page.js').then((m) => ({ default: m.LeadDetailPage })),
);
const TeamPage = lazy(() =>
  import('../features/team/team-page.js').then((m) => ({ default: m.TeamPage })),
);
const DeskingPage = lazy(() =>
  import('../features/deals/desking-page.js').then((m) => ({ default: m.DeskingPage })),
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
      { path: 'organizations', element: lazyPage(<OrganizationsPage />) },
      { path: 'organizations/new', element: lazyPage(<OrganizationNewPage />) },
      { path: 'organizations/:orgId', element: lazyPage(<OrganizationDetailPage />) },
      { path: 'organizations/:orgId/stores/new', element: lazyPage(<StoreFormPage />) },
      { path: 'organizations/:orgId/stores/:storeId', element: lazyPage(<StoreFormPage />) },
      { path: 'leads', element: lazyPage(<LeadsPage />) },
      { path: 'leads/new', element: lazyPage(<LeadNewPage />) },
      { path: 'leads/:leadId', element: lazyPage(<LeadDetailPage />) },
      { path: 'leads/:leadId/desk', element: lazyPage(<DeskingPage />) },
      { path: 'team', element: lazyPage(<TeamPage />) },
      // Placeholder module routes land with their feature slices.
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
