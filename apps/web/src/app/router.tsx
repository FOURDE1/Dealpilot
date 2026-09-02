import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import { AppLayout } from './layout.js';
import { RedirectIfAuthed, RequireAuth } from './guards.js';
import { AdminLayout } from './admin-layout.js';
import { RequirePlatform } from '../features/admin/require-platform.js';

const SignInPage = lazy(() =>
  import('../features/auth/sign-in-page.js').then((m) => ({ default: m.SignInPage })),
);
const TwoFactorPage = lazy(() =>
  import('../features/auth/two-factor-page.js').then((m) => ({ default: m.TwoFactorPage })),
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
const WinLossPage = lazy(() =>
  import('../features/reports/win-loss-page.js').then((m) => ({ default: m.WinLossPage })),
);
const SourceRoiPage = lazy(() =>
  import('../features/reports/source-roi-page.js').then((m) => ({ default: m.SourceRoiPage })),
);
const LeaderboardPage = lazy(() =>
  import('../features/reports/leaderboard-page.js').then((m) => ({ default: m.LeaderboardPage })),
);
const HeatmapPage = lazy(() =>
  import('../features/reports/heatmap-page.js').then((m) => ({ default: m.HeatmapPage })),
);
const TasksPage = lazy(() =>
  import('../features/tasks/tasks-page.js').then((m) => ({ default: m.TasksPage })),
);
const TenantDirectoryPage = lazy(() =>
  import('../features/admin/tenant-directory-page.js').then((m) => ({ default: m.TenantDirectoryPage })),
);
const TenantDetailPage = lazy(() =>
  import('../features/admin/tenant-detail-page.js').then((m) => ({ default: m.TenantDetailPage })),
);
const TenantNewPage = lazy(() =>
  import('../features/admin/tenant-new-page.js').then((m) => ({ default: m.TenantNewPage })),
);
const TenantUsagePage = lazy(() =>
  import('../features/admin/tenant-usage-page.js').then((m) => ({ default: m.TenantUsagePage })),
);
const TenantSnapshotPage = lazy(() =>
  import('../features/admin/tenant-snapshot-page.js').then((m) => ({ default: m.TenantSnapshotPage })),
);
const QueuesPage = lazy(() =>
  import('../features/admin/queues-page.js').then((m) => ({ default: m.QueuesPage })),
);
const QueueDlqPage = lazy(() =>
  import('../features/admin/queues-page.js').then((m) => ({ default: m.QueueDlqPage })),
);
const PlatformStaffPage = lazy(() =>
  import('../features/admin/platform-staff-page.js').then((m) => ({ default: m.PlatformStaffPage })),
);
const ImpersonationPage = lazy(() =>
  import('../features/admin/impersonation-page.js').then((m) => ({ default: m.ImpersonationPage })),
);
const ImpersonationDetailPage = lazy(() =>
  import('../features/admin/impersonation-detail-page.js').then((m) => ({ default: m.ImpersonationDetailPage })),
);
const AnnouncementsPage = lazy(() =>
  import('../features/admin/announcements-page.js').then((m) => ({ default: m.AnnouncementsPage })),
);
const AnnouncementComposePage = lazy(() =>
  import('../features/admin/announcement-compose-page.js').then((m) => ({ default: m.AnnouncementComposePage })),
);
const AnnouncementDetailPage = lazy(() =>
  import('../features/admin/announcement-detail-page.js').then((m) => ({ default: m.AnnouncementDetailPage })),
);
const PlatformSettingsPage = lazy(() =>
  import('../features/admin/platform-settings-page.js').then((m) => ({ default: m.PlatformSettingsPage })),
);
const DuplicatesPage = lazy(() =>
  import('../features/leads/duplicates-page.js').then((m) => ({ default: m.DuplicatesPage })),
);
const LostReasonsPage = lazy(() =>
  import('../features/leads/lost-reasons-page.js').then((m) => ({ default: m.LostReasonsPage })),
);
const BeBackPage = lazy(() =>
  import('../features/leads/beback-page.js').then((m) => ({ default: m.BeBackPage })),
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
const SecurityPage = lazy(() =>
  import('../features/auth/security-page.js').then((m) => ({ default: m.SecurityPage })),
);
const AssignmentRulesPage = lazy(() =>
  import('../features/assignment/assignment-rules-page.js').then((m) => ({ default: m.AssignmentRulesPage })),
);
const ScoringRulesPage = lazy(() =>
  import('../features/scoring/scoring-rules-page.js').then((m) => ({ default: m.ScoringRulesPage })),
);
const DistributionPage = lazy(() =>
  import('../features/distribution/distribution-page.js').then((m) => ({ default: m.DistributionPage })),
);
const ConnectorsPage = lazy(() =>
  import('../features/connectors/connectors-page.js').then((m) => ({ default: m.ConnectorsPage })),
);
const SchedulesPage = lazy(() =>
  import('../features/schedules/schedules-page.js').then((m) => ({ default: m.SchedulesPage })),
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
const SettingsIndexPage = lazy(() =>
  import('../features/settings/settings-index-page.js').then((m) => ({ default: m.SettingsIndexPage })),
);
const SettingsStoresPage = lazy(() =>
  import('../features/settings/settings-stores-page.js').then((m) => ({ default: m.SettingsStoresPage })),
);
const AutomationsPage = lazy(() =>
  import('../features/settings/automations-page.js').then((m) => ({ default: m.AutomationsPage })),
);
const LendersPage = lazy(() =>
  import('../features/settings/lenders-page.js').then((m) => ({ default: m.LendersPage })),
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
    path: '/login/verify',
    element: <RedirectIfAuthed>{lazyPage(<TwoFactorPage />)}</RedirectIfAuthed>,
  },
  {
    path: '/signup',
    element: <RedirectIfAuthed>{lazyPage(<SignUpPage />)}</RedirectIfAuthed>,
  },
  // F-69: the platform console — same origin until the host split (O-8),
  // its own shell, its own door (identity → MFA → session age).
  {
    path: '/admin',
    element: (
      <RequireAuth>
        <RequirePlatform>
          <AdminLayout />
        </RequirePlatform>
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="/admin/tenants" replace /> },
      { path: 'tenants', element: lazyPage(<TenantDirectoryPage />) },
      // Before the id route: `new` is a page, not a tenant (F-70).
      { path: 'tenants/new', element: lazyPage(<TenantNewPage />) },
      { path: 'tenants/:tenantId', element: lazyPage(<TenantDetailPage />) },
      // F-73: what one tenant used, per window (§6). Reached from the tenant
      // page, not the nav — it answers a question about a tenant already open.
      { path: 'tenants/:tenantId/usage', element: lazyPage(<TenantUsagePage />) },
      // F-77: the operating facts a support call needs, on one screen. A
      // sibling of the usage route for the same reason — reached from the
      // tenant page, never from the nav.
      { path: 'tenants/:tenantId/snapshot', element: lazyPage(<TenantSnapshotPage />) },
      { path: 'staff', element: lazyPage(<PlatformStaffPage />) },
      // F-71: the support-session register and one session's trail.
      { path: 'support-sessions', element: lazyPage(<ImpersonationPage />) },
      { path: 'support-sessions/:sessionId', element: lazyPage(<ImpersonationDetailPage />) },
      // F-72: the announcement register, and §5.3's kill switches.
      { path: 'announcements', element: lazyPage(<AnnouncementsPage />) },
      // Before the id route: `new` is a page, not an announcement.
      { path: 'announcements/new', element: lazyPage(<AnnouncementComposePage />) },
      { path: 'announcements/:announcementId', element: lazyPage(<AnnouncementDetailPage />) },
      { path: 'platform-settings', element: lazyPage(<PlatformSettingsPage />) },
      // F-73: the ten queues, and one queue's failed set. Platform-wide, so
      // this one IS a nav item — a stuck queue belongs to no tenant.
      { path: 'queues', element: lazyPage(<QueuesPage />) },
      { path: 'queues/:queueName', element: lazyPage(<QueueDlqPage />) },
      { path: '*', element: <Navigate to="/admin/tenants" replace /> },
    ],
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
      { path: 'security', element: lazyPage(<SecurityPage />) },
      { path: 'appointments', element: lazyPage(<AppointmentsPage />) },
      { path: 'contacts', element: lazyPage(<ContactsPage />) },
      { path: 'contacts/:contactId', element: lazyPage(<ContactDetailPage />) },
      { path: 'leads', element: lazyPage(<LeadsPage />) },
      { path: 'leads/scoring', element: lazyPage(<ScoringRulesPage />) },
      { path: 'leads/distribution', element: lazyPage(<DistributionPage />) },
      { path: 'leads/connectors', element: lazyPage(<ConnectorsPage />) },
      { path: 'leads/assignment', element: lazyPage(<AssignmentRulesPage />) },
      { path: 'leads/be-back', element: lazyPage(<BeBackPage />) },
      { path: 'leads/lost-reasons', element: lazyPage(<LostReasonsPage />) },
      { path: 'leads/duplicates', element: lazyPage(<DuplicatesPage />) },
      { path: 'leads/new', element: lazyPage(<LeadNewPage />) },
      { path: 'leads/:leadId', element: lazyPage(<LeadDetailPage />) },
      { path: 'leads/:leadId/desk', element: lazyPage(<DeskingPage />) },
      { path: 'leads/:leadId/desk/:dealId', element: lazyPage(<DeskingPage />) },
      { path: 'team', element: lazyPage(<TeamPage />) },
      { path: 'team/permissions', element: lazyPage(<PermissionsPage />) },
      { path: 'team/schedules', element: lazyPage(<SchedulesPage />) },
      { path: 'pipeline', element: lazyPage(<PipelinePage />) },
      { path: 'inventory', element: lazyPage(<InventoryPage />) },
      { path: 'inventory/:vehicleId', element: lazyPage(<VehicleDetailPage />) },
      { path: 'commissions', element: lazyPage(<CommissionsPage />) },
      { path: 'dispatch', element: lazyPage(<DispatchPage />) },
      { path: 'conversations', element: lazyPage(<ConversationsPage />) },
      { path: 'analytics/win-loss', element: lazyPage(<WinLossPage />) },
      { path: 'analytics/source-roi', element: lazyPage(<SourceRoiPage />) },
      { path: 'analytics/leaderboard', element: lazyPage(<LeaderboardPage />) },
      { path: 'analytics/activity-heatmap', element: lazyPage(<HeatmapPage />) },
      { path: 'tasks', element: lazyPage(<TasksPage />) },
      // F-76 (D-077): the settings group is ADDITIVE — the index links the
      // existing configuration pages at their existing addresses; only the
      // stores list and the automations form are new screens. Editing a
      // store stays at /organizations/:orgId/stores/:storeId.
      { path: 'settings', element: lazyPage(<SettingsIndexPage />) },
      { path: 'settings/stores', element: lazyPage(<SettingsStoresPage />) },
      { path: 'settings/automations', element: lazyPage(<AutomationsPage />) },
      { path: 'settings/lenders', element: lazyPage(<LendersPage />) },
      // Placeholder module routes land with their feature slices.
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
