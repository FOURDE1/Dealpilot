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
const BrandingEditorPage = lazy(() =>
  import('../features/branding/branding-editor-page.js').then((m) => ({ default: m.BrandingEditorPage })),
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
const AppointmentsPage = lazy(() =>
  import('../features/appointments/appointments-page.js').then((m) => ({ default: m.AppointmentsPage })),
);
const AssignmentRulesPage = lazy(() =>
  import('../features/assignment/assignment-rules-page.js').then((m) => ({ default: m.AssignmentRulesPage })),
);
const ScoringRulesPage = lazy(() =>
  import('../features/scoring/scoring-rules-page.js').then((m) => ({ default: m.ScoringRulesPage })),
);
const ContactsPage = lazy(() =>
  import('../features/contacts/contacts-page.js').then((m) => ({ default: m.ContactsPage })),
);
const ContactDetailPage = lazy(() =>
  import('../features/contacts/contact-detail-page.js').then((m) => ({ default: m.ContactDetailPage })),
);
const TeamPage = lazy(() =>
  import('../features/team/team-page.js').then((m) => ({ default: m.TeamPage })),
);
const DeskingPage = lazy(() =>
  import('../features/deals/desking-page.js').then((m) => ({ default: m.DeskingPage })),
);
const PipelinePage = lazy(() =>
  import('../features/deals/pipeline-page.js').then((m) => ({ default: m.PipelinePage })),
);
const InventoryPage = lazy(() =>
  import('../features/inventory/inventory-page.js').then((m) => ({ default: m.InventoryPage })),
);
const VehicleDetailPage = lazy(() =>
  import('../features/inventory/vehicle-detail-page.js').then((m) => ({ default: m.VehicleDetailPage })),
);
const CommissionsPage = lazy(() =>
  import('../features/commissions/commissions-page.js').then((m) => ({ default: m.CommissionsPage })),
);
const DispatchPage = lazy(() =>
  import('../features/dispatch/dispatch-page.js').then((m) => ({ default: m.DispatchPage })),
);
const PermissionsPage = lazy(() =>
  import('../features/permissions/permissions-page.js').then((m) => ({ default: m.PermissionsPage })),
);
const ConversationsPage = lazy(() =>
  import('../features/conversations/conversations-page.js').then((m) => ({ default: m.ConversationsPage })),
);
const InvitationAcceptPage = lazy(() =>
  import('../features/invitations/accept-page.js').then((m) => ({ default: m.InvitationAcceptPage })),
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
    // PUBLIC: the invitation email lands here; no session required to preview.
    path: '/invitations/:token',
    element: lazyPage(<InvitationAcceptPage />),
  },
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
      { path: 'organizations/:orgId/branding', element: lazyPage(<BrandingEditorPage />) },
      { path: 'appointments', element: lazyPage(<AppointmentsPage />) },
      { path: 'contacts', element: lazyPage(<ContactsPage />) },
      { path: 'contacts/:contactId', element: lazyPage(<ContactDetailPage />) },
      { path: 'leads', element: lazyPage(<LeadsPage />) },
      { path: 'leads/scoring', element: lazyPage(<ScoringRulesPage />) },
      { path: 'leads/assignment', element: lazyPage(<AssignmentRulesPage />) },
      { path: 'leads/new', element: lazyPage(<LeadNewPage />) },
      { path: 'leads/:leadId', element: lazyPage(<LeadDetailPage />) },
      { path: 'leads/:leadId/desk', element: lazyPage(<DeskingPage />) },
      { path: 'leads/:leadId/desk/:dealId', element: lazyPage(<DeskingPage />) },
      { path: 'team', element: lazyPage(<TeamPage />) },
      { path: 'team/permissions', element: lazyPage(<PermissionsPage />) },
      { path: 'pipeline', element: lazyPage(<PipelinePage />) },
      { path: 'inventory', element: lazyPage(<InventoryPage />) },
      { path: 'inventory/:vehicleId', element: lazyPage(<VehicleDetailPage />) },
      { path: 'commissions', element: lazyPage(<CommissionsPage />) },
      { path: 'dispatch', element: lazyPage(<DispatchPage />) },
      { path: 'conversations', element: lazyPage(<ConversationsPage />) },
      // Placeholder module routes land with their feature slices.
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
