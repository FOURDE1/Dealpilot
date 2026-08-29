import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import {
  WinLossReport,
  WinLossQuery,
  LeadDuplicate,
  DuplicateScanResult,
  DuplicateScanInput,
  DuplicatePair,
  DuplicateListQuery,
  UpdateLostReasonInput,
  CreateLostReasonInput,
  LostReason,
  LostReasonListQuery,
  BeBackQuery,
  BeBackQueue,
  CreateLeadInput,
  CreateOrganizationInput,
  CreateStoreInput,
  CursorQuery,
  ErrorEnvelope,
  Lead,
  Organization,
  Store,
  ActivityEvent,
  DealDocument,
  ComplianceCheck,
  CommsConfig,
  CreateInternalDncInput,
  InternalDncRecord,
  UpdateCommsConfigInput,
  ComplianceCheckQuery,
  ConsentRecord,
  CreateSuppressionInput,
  RecordConsentInput,
  RevokeConsentInput,
  SuppressionRecord,
  PublishedBranding,
  TenantBranding,
  UpdateBrandingInput,
  BatchDocumentInput,
  DealFiProduct,
  CreateFiProductInput,
  UpdateFiProductInput,
  DealDocumentsResponse,
  DocumentListQuery,
  UpdateDocumentInput,
  Permission,
  PermissionMatrix,
  UpdateRolePermissionsInput,
  UpdateUserPermissionInput,
  UserPermissionOverride,
  ActivityListQuery,
  Contact,
  ContactListQuery,
  CreateContactInput,
  DuplicateMatch,
  MergeContactsInput,
  MergeContactsResult,
  Appointment,
  AppointmentListQuery,
  CancelAppointmentInput,
  CreateAppointmentInput,
  UpdateAppointmentInput,
  CreateScoringRuleInput,
  LeadScoreResult,
  LeadScoringRule,
  ScoringRuleListQuery,
  UpdateScoringRuleInput,
  AssignLeadResult,
  AssignmentRuleListQuery,
  CreateAssignmentRuleInput,
  LeadAssignmentRule,
  UpdateAssignmentRuleInput,
  UpdateContactInput,
  CloseConversationInput,
  Conversation,
  ConversationAnalysisRecord,
  ConversationListQuery,
  Message,
  MessageListQuery,
  SendAgentMessageInput,
  SpeedToLeadQuery,
  SpeedToLeadSummary,
  SendResult,
  TakeoverInput,
  ChaserVehicle,
  CreateChaserInput,
  CreateDispatchInput,
  CreateDriverCompanyInput,
  DriverCompany,
  DriverCompanyListQuery,
  UpdateDriverCompanyInput,
  CreateInvitationInput,
  CreatePlateInput,
  DealerPlate,
  DispatchAssignment,
  DispatchListQuery,
  FleetListQuery,
  UpdateChaserInput,
  UpdateDispatchInput,
  UpdatePlateInput,
  Invitation,
  InvitationListQuery,
  InvitationPreview,
  AddMemberInput,
  Commission,
  CommissionListQuery,
  CreatePayPlanInput,
  PayPlan,
  PayPlanListQuery,
  UpdatePayPlanInput,
  MemberAdded,
  CreateVehicleInput,
  UpdateVehicleInput,
  Vehicle,
  VehicleListQuery,
  CalculateDealInput,
  ChecklistCode,
  ChecklistReadiness,
  ChecklistTemplate,
  CreateDealInput,
  DealChecklistItem,
  UpdateChecklistItemInput,
  UpdateChecklistTemplateInput,
  Deal,
  DealListQuery,
  DeskingOutputs,
  UpdateDealInput,
  CreateIntakeKeyInput,
  Member,
  MemberListQuery,
  UpdateMemberInput,
  IntakeKey,
  IntakeKeyCreated,
  LeadListQuery,
  StoreListQuery,
  UpdateLeadInput,
  UpdateOrganizationInput,
  UpdateStoreInput,
  MeResponse,
  Uuid,
  paginated,
  StaffSchedule,
  StaffScheduleListQuery,
  CreateStaffScheduleInput,
  UpdateStaffScheduleInput,
  CascadeAssignResult,
  ScheduleTodayItem,
  DistributionQuery,
  DistributionRow,
  PutDistributionConfigInput,
  NotificationList,
  TenantConnector,
  CreateConnectorInput,
  UpdateConnectorInput,
  ConnectorListQuery,
  DripSequence,
  CreateDripSequenceInput,
  UpdateDripSequenceInput,
  ListDripSequencesQuery,
  DripEnrollment,
  ListDripEnrollmentsQuery,
  SourceCost,
  UpsertSourceCostInput,
  ListSourceCostsQuery,
  SourceRoiReport,
  SourceRoiQuery,
  LeaderboardReport,
  LeaderboardQuery,
  HeatmapReport,
  Task,
  TaskListQuery,
  TaskListPage,
  TaskSummaryQuery,
  TaskSummary,
  CreateTaskInput,
  UpdateTaskInput,
  BulkCompleteTasksInput,
  BulkReassignTasksInput,
  BulkTasksResult,
  HeatmapQuery,
  AdminMeResponse,
  PlanList,
  AdminTenantListQuery,
  AdminTenantPage,
  AdminTenantDetail,
  AdminTenantEventsQuery,
  AdminTenantEventsResponse,
  AdminUpdateTenantInput,
  TenantStatusChangeInput,
  TenantStatusChangeResult,
  PlatformStaffList,
  GrantPlatformStaffInput,
  PlatformStaffGranted,
  ProvisionTenantInput,
  AdminTenantProvisioned,
  ReissueOwnerInvitationInput,
  OwnerInvitationReissued,
  StartImpersonationInput,
  ImpersonationSession,
  ImpersonationSessionDetail,
  ImpersonationList,
  ImpersonationListQuery,
  AdminTenantMembers,
  SupportAccessList,
  SupportAccessQuery,
} from '@dealpilot/schemas';
const c = initContract();

/**
 * Every endpoint can answer with the canonical error envelope (api-design.md §8).
 * 409: unique-constraint conflicts (org slug, store code, membership triple).
 * 429: platform-wide rate limiting (ADR-011).
 */
const errorResponses = {
  400: ErrorEnvelope,
  401: ErrorEnvelope,
  /** F-69: a read_only tenant's mutations (admin-console.md §4.2). */
  402: ErrorEnvelope,
  403: ErrorEnvelope,
  404: ErrorEnvelope,
  409: ErrorEnvelope,
  422: ErrorEnvelope,
  429: ErrorEnvelope,
  500: ErrorEnvelope,
} as const;

const idParams = z.object({ id: Uuid });

/** Standard CRUD + cursor-paginated list router for one resource. */
const crudRouter = <
  Entity extends z.ZodType,
  CreateInput extends z.ZodType,
  UpdateInput extends z.ZodType,
  ListQuery extends z.ZodType = typeof CursorQuery,
>(
  path: string,
  entity: Entity,
  createInput: CreateInput,
  updateInput: UpdateInput,
  listQuery?: ListQuery,
) =>
  c.router({
    create: {
      method: 'POST',
      path: `/api/v1/${path}`,
      body: createInput,
      responses: { 201: entity, ...errorResponses },
    },
    get: {
      method: 'GET',
      path: `/api/v1/${path}/:id`,
      pathParams: idParams,
      responses: { 200: entity, ...errorResponses },
    },
    list: {
      method: 'GET',
      path: `/api/v1/${path}`,
      query: listQuery ?? CursorQuery,
      responses: { 200: paginated(entity), ...errorResponses },
    },
    update: {
      method: 'PATCH',
      path: `/api/v1/${path}/:id`,
      pathParams: idParams,
      body: updateInput,
      responses: { 200: entity, ...errorResponses },
    },
    /** Soft delete (ADR-009) — for memberships this is the revoke path. */
    delete: {
      method: 'DELETE',
      path: `/api/v1/${path}/:id`,
      pathParams: idParams,
      body: c.noBody(),
      responses: { 204: c.noBody(), ...errorResponses },
    },
  });

/**
 * REST /api/v1 baseline contract (A-03): CRUD + cursor-paginated list for
 * organization, store, user, membership, lead. This is THE interface between
 * backend and frontend (TEAM-WORKFLOW §4) — the web app imports these types
 * and never hand-writes API shapes.
 */
export const apiV1 = c.router({
  auth: c.router({
    /** Session probe (A-05). Sign-up/in/out flow via Better Auth /api/auth/*. */
    me: {
      method: 'GET',
      path: '/api/v1/me',
      responses: { 200: MeResponse, ...errorResponses },
    },
  }),
  organizations: crudRouter('organizations', Organization, CreateOrganizationInput, UpdateOrganizationInput),
  // Store list is org-scoped (F-01): the selector is verified against the
  // caller's memberships server-side — never an authority claim.
  stores: crudRouter('stores', Store, CreateStoreInput, UpdateStoreInput, StoreListQuery),
  // NO users/memberships CRUD. The A-03 scaffold declared both generically and
  // neither was ever mounted, so the contract advertised ten endpoints that
  // answer 404 — found by contract-coverage.test.ts, not by eye. Identities come
  // from Better Auth, and F-04 manages the roster through /api/v1/members. If
  // either is ever wanted, declare it here in the same commit that mounts it.
  leads: crudRouter('leads', Lead, CreateLeadInput, UpdateLeadInput, LeadListQuery),
  /** F-09 pay plans + the commission lines a funded deal produces. */
  payPlans: c.router({
    upsert: {
      method: 'POST',
      path: '/api/v1/pay-plans',
      body: CreatePayPlanInput,
      responses: { 201: PayPlan, ...errorResponses },
    },
    list: {
      method: 'GET',
      path: '/api/v1/pay-plans',
      query: PayPlanListQuery,
      responses: { 200: paginated(PayPlan), ...errorResponses },
    },
    update: {
      method: 'PATCH',
      path: '/api/v1/pay-plans/:id',
      pathParams: z.object({ id: Uuid }),
      body: UpdatePayPlanInput,
      responses: { 200: PayPlan, ...errorResponses },
    },
  }),
  /**
   * F-11 dispatch: the drivers, plate and chaser that get a sold car to the
   * customer. The server picks the resources — choosing is where double
   * bookings come from.
   */
  dispatch: c.router({
    /** F-11c: what happened to this run, in order — read from the activity trail. */
    statusUpdates: {
      method: 'GET',
      path: '/api/v1/dispatch/:id/status-updates',
      pathParams: z.object({ id: Uuid }),
      responses: { 200: z.object({ items: z.array(ActivityEvent) }), ...errorResponses },
    },
    book: {
      method: 'POST',
      path: '/api/v1/dispatch',
      body: CreateDispatchInput,
      responses: { 201: DispatchAssignment, ...errorResponses },
    },
    list: {
      method: 'GET',
      path: '/api/v1/dispatch',
      query: DispatchListQuery,
      responses: { 200: paginated(DispatchAssignment), ...errorResponses },
    },
    /** Send the driver request again — the first bounced, or plans changed. */
    resend: {
      method: 'POST',
      path: '/api/v1/dispatch/:id/resend',
      pathParams: z.object({ id: Uuid }),
      body: z.object({}).optional(),
      responses: { 200: z.object({ sent: z.boolean() }), ...errorResponses },
    },
    /** Move the run along, or record the driver and ETAs. */
    update: {
      method: 'PATCH',
      path: '/api/v1/dispatch/:id',
      pathParams: z.object({ id: Uuid }),
      body: UpdateDispatchInput,
      responses: { 200: DispatchAssignment, ...errorResponses },
    },
  }),
  /**
   * F-11b driver companies: the roster that replaced a two-name enum. A company
   * with no store belongs to the whole group.
   */
  driverCompanies: c.router({
    create: {
      method: 'POST',
      path: '/api/v1/driver-companies',
      body: CreateDriverCompanyInput,
      responses: { 201: DriverCompany, ...errorResponses },
    },
    list: {
      method: 'GET',
      path: '/api/v1/driver-companies',
      query: DriverCompanyListQuery,
      responses: { 200: paginated(DriverCompany), ...errorResponses },
    },
    update: {
      method: 'PATCH',
      path: '/api/v1/driver-companies/:id',
      pathParams: z.object({ id: Uuid }),
      body: UpdateDriverCompanyInput,
      responses: { 200: DriverCompany, ...errorResponses },
    },
  }),
  /** F-11 fleet: the follow cars that bring drivers home. */
  chasers: c.router({
    create: {
      method: 'POST',
      path: '/api/v1/chasers',
      body: CreateChaserInput,
      responses: { 201: ChaserVehicle, ...errorResponses },
    },
    list: {
      method: 'GET',
      path: '/api/v1/chasers',
      query: FleetListQuery,
      responses: { 200: paginated(ChaserVehicle), ...errorResponses },
    },
    update: {
      method: 'PATCH',
      path: '/api/v1/chasers/:id',
      pathParams: z.object({ id: Uuid }),
      body: UpdateChaserInput,
      responses: { 200: ChaserVehicle, ...errorResponses },
    },
    /** Retire it. Refused (409 in_use) while a booked run is counting on it. */
    retire: {
      method: 'DELETE',
      path: '/api/v1/chasers/:id',
      pathParams: z.object({ id: Uuid }),
      responses: { 204: z.void(), ...errorResponses },
    },
  }),
  /** F-11 fleet: dealer plates, for units that are not registered yet. */
  plates: c.router({
    create: {
      method: 'POST',
      path: '/api/v1/plates',
      body: CreatePlateInput,
      responses: { 201: DealerPlate, ...errorResponses },
    },
    list: {
      method: 'GET',
      path: '/api/v1/plates',
      query: FleetListQuery,
      responses: { 200: paginated(DealerPlate), ...errorResponses },
    },
    update: {
      method: 'PATCH',
      path: '/api/v1/plates/:id',
      pathParams: z.object({ id: Uuid }),
      body: UpdatePlateInput,
      responses: { 200: DealerPlate, ...errorResponses },
    },
    /** Retire it. Refused (409 in_use) while a booked run is counting on it. */
    retire: {
      method: 'DELETE',
      path: '/api/v1/plates/:id',
      pathParams: z.object({ id: Uuid }),
      responses: { 204: z.void(), ...errorResponses },
    },
  }),
  /**
   * F-12 invitations (D-035): an invited person can now actually log in. The
   * link carries a token we never store — only its SHA-256 — and accepting
   * requires being signed in AS the invited email.
   */
  invitations: c.router({
    create: {
      method: 'POST',
      path: '/api/v1/invitations',
      body: CreateInvitationInput,
      responses: { 201: Invitation, ...errorResponses },
    },
    list: {
      method: 'GET',
      path: '/api/v1/invitations',
      query: InvitationListQuery,
      responses: { 200: paginated(Invitation), ...errorResponses },
    },
    /**
     * PUBLIC — the invitee has no account yet. Name, email, roles; nothing else.
     * POST for a read so the token stays out of URLs, logs and browser history.
     */
    preview: {
      method: 'POST',
      path: '/api/v1/invitations/preview',
      body: z.object({ token: z.string() }),
      responses: { 200: InvitationPreview, ...errorResponses },
    },
    accept: {
      method: 'POST',
      path: '/api/v1/invitations/accept',
      body: z.object({ token: z.string() }),
      responses: {
        201: z.object({ organization_id: Uuid, membership_id: Uuid }),
        ...errorResponses,
      },
    },
    revoke: {
      method: 'DELETE',
      path: '/api/v1/invitations/:id',
      pathParams: z.object({ id: Uuid }),
      responses: { 204: z.void(), ...errorResponses },
    },
  }),
  /**
   * A-13 permissions (D-033): the matrix that answers "what can this role do?"
   * — readable by any member, changeable only by someone who may change roles.
   */
  permissions: c.router({
    matrix: {
      method: 'GET',
      path: '/api/v1/permissions',
      query: z.object({ organization_id: Uuid.optional() }),
      responses: { 200: PermissionMatrix, ...errorResponses },
    },
    /** What the SIGNED-IN person may do, so the UI can hide what would 403. */
    mine: {
      method: 'GET',
      path: '/api/v1/permissions/mine',
      query: z.object({ organization_id: Uuid.optional() }),
      responses: { 200: z.object({ permissions: z.array(Permission) }), ...errorResponses },
    },
    /** Replace one role's set. The list is complete: absent means revoked. */
    setRole: {
      method: 'PUT',
      path: '/api/v1/permissions/role',
      body: UpdateRolePermissionsInput,
      responses: { 200: PermissionMatrix, ...errorResponses },
    },
    /** The exceptions that exist, so the screen can show and clear them. */
    overrides: {
      method: 'GET',
      path: '/api/v1/permissions/overrides',
      query: z.object({ organization_id: Uuid.optional(), user_id: Uuid.optional() }),
      responses: { 200: z.object({ items: z.array(UserPermissionOverride) }), ...errorResponses },
    },
    /** One person's exception — grant OR deny. null clears it. */
    setUser: {
      method: 'PUT',
      path: '/api/v1/permissions/user',
      body: UpdateUserPermissionInput,
      responses: { 204: z.void(), ...errorResponses },
    },
  }),
  /**
   * F-13 deal documents: which papers this deal needs, derived from its own
   * shape, and whether the signed file is actually complete.
   */
  documents: c.router({
    forDeal: {
      method: 'GET',
      path: '/api/v1/deals/:id/documents',
      pathParams: z.object({ id: Uuid }),
      responses: { 200: DealDocumentsResponse, ...errorResponses },
    },
    list: {
      method: 'GET',
      path: '/api/v1/documents',
      query: DocumentListQuery,
      responses: { 200: paginated(DealDocument), ...errorResponses },
    },
    /**
     * F-13c: attach the scanned page.
     *
     * The body is RAW BYTES with a real content-type header
     * (application/pdf, image/jpeg, image/png) — ts-rest models only JSON and
     * form bodies, so `z.any()` is as close as the contract gets and the route
     * reads `request.body` as a Buffer. Declared here anyway so it exists in
     * one place and the coverage guard sees it.
     */
    uploadFile: {
      method: 'POST',
      path: '/api/v1/documents/:id/file',
      pathParams: z.object({ id: Uuid }),
      body: z.any(),
      responses: { 201: DealDocument, ...errorResponses },
    },
    /** The stored page back, with its hash rechecked on the way out. */
    downloadFile: {
      method: 'GET',
      path: '/api/v1/documents/:id/file',
      pathParams: z.object({ id: Uuid }),
      responses: { 200: z.any(), ...errorResponses },
    },
    /** Mark a stack of documents printed or filed in one transaction. */
    batch: {
      method: 'POST',
      path: '/api/v1/deals/:id/documents/batch',
      pathParams: z.object({ id: Uuid }),
      body: BatchDocumentInput,
      responses: { 200: z.object({ items: z.array(DealDocument) }), ...errorResponses },
    },
    /** Move a document along its lifecycle, or record its e-sign details. */
    update: {
      method: 'PATCH',
      path: '/api/v1/documents/:id',
      pathParams: z.object({ id: Uuid }),
      body: UpdateDocumentInput,
      responses: { 200: DealDocument, ...errorResponses },
    },
  }),
  /**
   * F-13b itemised F&I. The per-product agreements in a deal's file are named
   * after these rows; without them three document types were unreachable.
   */
  fiProducts: c.router({
    forDeal: {
      method: 'GET',
      path: '/api/v1/deals/:id/fi-products',
      pathParams: z.object({ id: Uuid }),
      responses: { 200: z.array(DealFiProduct), ...errorResponses },
    },
    create: {
      method: 'POST',
      path: '/api/v1/deals/:id/fi-products',
      pathParams: z.object({ id: Uuid }),
      body: CreateFiProductInput,
      responses: { 201: DealFiProduct, ...errorResponses },
    },
    update: {
      method: 'PATCH',
      path: '/api/v1/fi-products/:id',
      pathParams: z.object({ id: Uuid }),
      body: UpdateFiProductInput,
      responses: { 200: DealFiProduct, ...errorResponses },
    },
    remove: {
      method: 'DELETE',
      path: '/api/v1/fi-products/:id',
      pathParams: z.object({ id: Uuid }),
      responses: { 204: z.void(), ...errorResponses },
    },
  }),
  /**
   * F-14 white-label branding (ADR-018). Draft and published are different
   * things on purpose: the SPA is only ever handed a published palette.
   */
  branding: c.router({
    /** What the SPA loads before first paint. `null` = the platform default. */
    current: {
      method: 'GET',
      path: '/api/v1/branding',
      query: z.object({ organization_id: Uuid.optional(), store_id: Uuid.optional() }),
      responses: { 200: PublishedBranding.nullable(), ...errorResponses },
    },
    /** The editor's view of the draft. */
    get: {
      method: 'GET',
      path: '/api/v1/organizations/:id/branding',
      pathParams: z.object({ id: Uuid }),
      /** Omit store_id for the group brand; pass one for a rooftop sub-brand. */
      query: z.object({ store_id: Uuid.optional() }),
      /** null = never branded; start from BRANDING_DEFAULTS. */
      responses: { 200: TenantBranding.nullable(), ...errorResponses },
    },
    update: {
      method: 'PUT',
      path: '/api/v1/organizations/:id/branding',
      pathParams: z.object({ id: Uuid }),
      query: z.object({ store_id: Uuid.optional() }),
      body: UpdateBrandingInput,
      responses: { 200: TenantBranding, ...errorResponses },
    },
    /**
     * Upload a brand asset — raw bytes with a real image content-type, like the
     * document upload. Slots: logo_light | logo_dark | favicon | email_logo |
     * login_bg.
     */
    uploadAsset: {
      method: 'POST',
      path: '/api/v1/organizations/:id/branding/assets/:slot',
      pathParams: z.object({ id: Uuid, slot: z.string() }),
      query: z.object({ store_id: Uuid.optional() }),
      body: z.any(),
      responses: { 201: TenantBranding, ...errorResponses },
    },
    /** Serve a PUBLISHED brand asset. Render with `<img src>`, never inlined. */
    asset: {
      method: 'GET',
      path: '/api/v1/branding/assets/:slot',
      pathParams: z.object({ slot: z.string() }),
      query: z.object({ organization_id: Uuid.optional(), store_id: Uuid.optional() }),
      responses: { 200: z.any(), ...errorResponses },
    },
    /** Compute the palette, auto-fix contrast, make it live. */
    publish: {
      method: 'POST',
      path: '/api/v1/organizations/:id/branding/publish',
      pathParams: z.object({ id: Uuid }),
      query: z.object({ store_id: Uuid.optional() }),
      body: z.object({}).optional(),
      responses: { 200: TenantBranding, ...errorResponses },
    },
  }),
  /**
   * F-15 compliance (CASL / CRTC / Law 25). The consent ledger, the stop list,
   * and the one question the send layer asks before every message.
   */
  compliance: c.router({
    recordConsent: {
      method: 'POST',
      path: '/api/v1/consent',
      body: RecordConsentInput,
      responses: { 201: z.array(ConsentRecord), ...errorResponses },
    },
    forLead: {
      method: 'GET',
      path: '/api/v1/leads/:id/consent',
      pathParams: z.object({ id: Uuid }),
      responses: { 200: z.object({ items: z.array(ConsentRecord) }), ...errorResponses },
    },
    revokeConsent: {
      method: 'POST',
      path: '/api/v1/consent/:id/revoke',
      pathParams: z.object({ id: Uuid }),
      body: RevokeConsentInput,
      responses: { 200: ConsentRecord, ...errorResponses },
    },
    suppress: {
      method: 'POST',
      path: '/api/v1/suppressions',
      body: CreateSuppressionInput,
      responses: { 201: SuppressionRecord, ...errorResponses },
    },
    /** Never call this person again. There is no undo, by design (§4). */
    internalDnc: {
      method: 'POST',
      path: '/api/v1/internal-dnc',
      body: CreateInternalDncInput,
      responses: { 201: InternalDncRecord, ...errorResponses },
    },
    commsConfig: {
      method: 'GET',
      path: '/api/v1/organizations/:id/comms-config',
      pathParams: z.object({ id: Uuid }),
      responses: { 200: CommsConfig.nullable(), ...errorResponses },
    },
    /** Narrow the messaging window. The platform ceiling cannot be widened. */
    updateCommsConfig: {
      method: 'PUT',
      path: '/api/v1/organizations/:id/comms-config',
      pathParams: z.object({ id: Uuid }),
      body: UpdateCommsConfigInput,
      responses: { 200: CommsConfig, ...errorResponses },
    },
    /** May we contact this lead right now, and if not what would fix it. */
    check: {
      method: 'GET',
      path: '/api/v1/leads/:id/compliance',
      pathParams: z.object({ id: Uuid }),
      query: ComplianceCheckQuery,
      responses: { 200: ComplianceCheck, ...errorResponses },
    },
  }),
  /** F-55 analytics (reports-analytics.md): the business's aggregate numbers. */
  analytics: c.router({
    winLoss: {
      method: 'GET',
      path: '/api/v1/analytics/win-loss',
      query: WinLossQuery,
      responses: { 200: WinLossReport, ...errorResponses },
    },
  }),
  /** F-54 duplicates (leads.md §8): pairs, scans, and the two verbs. */
  duplicates: c.router({
    list: {
      method: 'GET',
      path: '/api/v1/duplicates',
      query: DuplicateListQuery,
      responses: {
        200: z.object({ items: z.array(DuplicatePair), next_cursor: z.string().nullable() }),
        ...errorResponses,
      },
    },
    scan: {
      method: 'POST',
      path: '/api/v1/duplicates/scan',
      body: DuplicateScanInput,
      responses: { 200: DuplicateScanResult, ...errorResponses },
    },
    scanLead: {
      method: 'POST',
      path: '/api/v1/leads/:id/duplicate-scan',
      pathParams: z.object({ id: Uuid }),
      body: z.undefined(),
      responses: { 200: DuplicateScanResult, ...errorResponses },
    },
    merge: {
      method: 'POST',
      path: '/api/v1/duplicates/:id/merge',
      pathParams: z.object({ id: Uuid }),
      body: z.undefined(),
      responses: { 200: LeadDuplicate, ...errorResponses },
    },
    dismiss: {
      method: 'POST',
      path: '/api/v1/duplicates/:id/dismiss',
      pathParams: z.object({ id: Uuid }),
      body: z.undefined(),
      responses: { 200: LeadDuplicate, ...errorResponses },
    },
  }),
  /** F-53 lost reasons (leads.md §11): tenant vocabulary for WHY. */
  lostReasons: c.router({
    list: {
      method: 'GET',
      path: '/api/v1/lost-reasons',
      query: LostReasonListQuery,
      responses: {
        200: z.object({ items: z.array(LostReason), next_cursor: z.string().nullable() }),
        ...errorResponses,
      },
    },
    create: {
      method: 'POST',
      path: '/api/v1/lost-reasons',
      body: CreateLostReasonInput,
      responses: { 201: LostReason, ...errorResponses },
    },
    update: {
      method: 'PATCH',
      path: '/api/v1/lost-reasons/:id',
      pathParams: z.object({ id: Uuid }),
      body: UpdateLostReasonInput,
      responses: { 200: LostReason, ...errorResponses },
    },
    remove: {
      method: 'DELETE',
      path: '/api/v1/lost-reasons/:id',
      pathParams: z.object({ id: Uuid }),
      body: z.undefined(),
      responses: { 204: z.undefined(), ...errorResponses },
    },
  }),
  /** F-61 drip sequences (automation-notifications.md §11): client-facing
   * nurture config + the enrollments riding it. No DELETE — a sequence with
   * history deactivates (active=false); erasing it would orphan the audit
   * trail of what was sent and why. */
  dripSequences: c.router({
    list: {
      method: 'GET',
      path: '/api/v1/drip-sequences',
      query: ListDripSequencesQuery,
      responses: {
        200: z.object({ items: z.array(DripSequence), next_cursor: z.string().nullable() }),
        ...errorResponses,
      },
    },
    create: {
      method: 'POST',
      path: '/api/v1/drip-sequences',
      body: CreateDripSequenceInput,
      responses: { 201: DripSequence, ...errorResponses },
    },
    update: {
      method: 'PATCH',
      path: '/api/v1/drip-sequences/:id',
      pathParams: z.object({ id: Uuid }),
      body: UpdateDripSequenceInput,
      responses: { 200: DripSequence, ...errorResponses },
    },
    enrollments: {
      method: 'GET',
      path: '/api/v1/drip-enrollments',
      query: ListDripEnrollmentsQuery,
      responses: {
        200: z.object({ items: z.array(DripEnrollment), next_cursor: z.string().nullable() }),
        ...errorResponses,
      },
    },
  }),
  /** F-65 marketing spend + source ROI (expenses-accounting.md §10,
   * reports-analytics.md §8). POST is an UPSERT: one row per
   * source/month/store, re-posting overwrites (§10). */
  sourceCosts: c.router({
    list: {
      method: 'GET',
      path: '/api/v1/source-costs',
      query: ListSourceCostsQuery,
      responses: {
        200: z.object({ items: z.array(SourceCost), next_cursor: z.string().nullable() }),
        ...errorResponses,
      },
    },
    upsert: {
      method: 'POST',
      path: '/api/v1/source-costs',
      body: UpsertSourceCostInput,
      responses: { 201: SourceCost, ...errorResponses },
    },
    remove: {
      method: 'DELETE',
      path: '/api/v1/source-costs/:id',
      pathParams: z.object({ id: Uuid }),
      body: z.undefined(),
      responses: { 204: z.undefined(), ...errorResponses },
    },
    roi: {
      method: 'GET',
      path: '/api/v1/analytics/source-roi',
      query: SourceRoiQuery,
      responses: { 200: SourceRoiReport, ...errorResponses },
    },
    /** F-66: the salesperson leaderboard (reports-analytics.md §10). */
    leaderboard: {
      method: 'GET',
      path: '/api/v1/analytics/leaderboard',
      query: LeaderboardQuery,
      responses: { 200: LeaderboardReport, ...errorResponses },
    },
    /** F-67: the store-level activity heatmap (reports-analytics.md §11 Target). */
    heatmap: {
      method: 'GET',
      path: '/api/v1/analytics/activity-heatmap',
      query: HeatmapQuery,
      responses: { 200: HeatmapReport, ...errorResponses },
    },
  }),
  /** F-52 be-back queue (leads.md §9): dormant leads worth another call. */
  beBack: c.router({
    queue: {
      method: 'GET',
      path: '/api/v1/leads/be-back',
      query: BeBackQuery,
      responses: { 200: BeBackQueue, ...errorResponses },
    },
  }),
  /** F-24 speed to lead (leads.md §5, ADR-025): the number this is sold on. */
  speedToLead: c.router({
    summary: {
      method: 'GET',
      path: '/api/v1/leads/speed-to-lead',
      query: SpeedToLeadQuery,
      responses: { 200: SpeedToLeadSummary, ...errorResponses },
    },
  }),
  /**
   * F-35 contacts — the customer master (FR-CON).
   *
   * No field here carries high-sensitivity PII. Date of birth, licence number,
   * SIN, income and banking are required by FR-CON-007 to be KMS-encrypted
   * (ADR-015) and no key is provisioned, so they are absent from the table AND
   * from this contract — an API that accepted them would silently drop the most
   * sensitive thing a customer hands over.
   */
  /**
   * F-40 lead assignment (leads.md §7). One rule wins (priority ASC, first
   * source match) — the opposite of scoring, where every rule counts. The
   * assign endpoint's refusals are named values, and the auto path never
   * reassigns: taking a lead off somebody is a human act.
   */
  assignmentRules: c.router({
    list: {
      method: 'GET',
      path: '/api/v1/assignment-rules',
      query: AssignmentRuleListQuery,
      responses: {
        200: z.object({ items: z.array(LeadAssignmentRule), next_cursor: z.string().nullable() }),
        ...errorResponses,
      },
    },
    create: {
      method: 'POST',
      path: '/api/v1/assignment-rules',
      body: CreateAssignmentRuleInput,
      responses: { 201: LeadAssignmentRule, ...errorResponses },
    },
    update: {
      method: 'PATCH',
      path: '/api/v1/assignment-rules/:id',
      pathParams: z.object({ id: Uuid }),
      body: UpdateAssignmentRuleInput,
      responses: { 200: LeadAssignmentRule, ...errorResponses },
    },
    remove: {
      method: 'DELETE',
      path: '/api/v1/assignment-rules/:id',
      pathParams: z.object({ id: Uuid }),
      responses: { 204: c.noBody(), ...errorResponses },
    },
    assignLead: {
      method: 'POST',
      path: '/api/v1/leads/:id/assign',
      pathParams: z.object({ id: Uuid }),
      body: c.noBody(),
      responses: { 200: AssignLeadResult, ...errorResponses },
    },
  }),
  /**
   * F-42 staff schedules + the §7.3 cascade (FR-LEAD-009/015, D-045). The
   * grid is team-visible; writing it is schedule:manage. The cascade endpoint
   * returns its decision as a VALUE — escalation is an outcome, not an error.
   */
  schedules: c.router({
    list: {
      method: 'GET',
      path: '/api/v1/staff-schedules',
      query: StaffScheduleListQuery,
      responses: {
        200: z.object({ items: z.array(StaffSchedule), next_cursor: z.string().nullable() }),
        ...errorResponses,
      },
    },
    create: {
      method: 'POST',
      path: '/api/v1/staff-schedules',
      body: CreateStaffScheduleInput,
      responses: { 201: StaffSchedule, ...errorResponses },
    },
    update: {
      method: 'PATCH',
      path: '/api/v1/staff-schedules/:id',
      pathParams: z.object({ id: Uuid }),
      body: UpdateStaffScheduleInput,
      responses: { 200: StaffSchedule, ...errorResponses },
    },
    remove: {
      method: 'DELETE',
      path: '/api/v1/staff-schedules/:id',
      pathParams: z.object({ id: Uuid }),
      responses: { 204: c.noBody(), ...errorResponses },
    },
    today: {
      method: 'GET',
      path: '/api/v1/schedules/today',
      query: z.object({ organization_id: Uuid.optional() }),
      responses: { 200: z.object({ items: z.array(ScheduleTodayItem) }), ...errorResponses },
    },
    cascadeAssign: {
      method: 'POST',
      path: '/api/v1/leads/:id/cascade-assign',
      pathParams: z.object({ id: Uuid }),
      body: c.noBody(),
      responses: { 200: CascadeAssignResult, ...errorResponses },
    },
  }),
  /**
   * F-49 tenant connectors (FR-LEAD-019): registering a lead provider is a
   * config row, not a deploy. intake_key:manage both ways.
   */
  connectors: c.router({
    list: {
      method: 'GET',
      path: '/api/v1/connectors',
      query: ConnectorListQuery,
      responses: {
        200: z.object({ items: z.array(TenantConnector), next_cursor: z.string().nullable() }),
        ...errorResponses,
      },
    },
    create: {
      method: 'POST',
      path: '/api/v1/connectors',
      body: CreateConnectorInput,
      responses: { 201: TenantConnector, ...errorResponses },
    },
    update: {
      method: 'PATCH',
      path: '/api/v1/connectors/:id',
      pathParams: z.object({ id: Uuid }),
      body: UpdateConnectorInput,
      responses: { 200: TenantConnector, ...errorResponses },
    },
    remove: {
      method: 'DELETE',
      path: '/api/v1/connectors/:id',
      pathParams: z.object({ id: Uuid }),
      responses: { 204: c.noBody(), ...errorResponses },
    },
  }),
  /**
   * F-47 staff notifications (automation-notifications.md §5/§14). Entirely
   * SELF-scoped: no organization parameter exists to ask about anyone else.
   */
  notifications: c.router({
    list: {
      method: 'GET',
      path: '/api/v1/notifications',
      responses: { 200: NotificationList, ...errorResponses },
    },
    read: {
      method: 'POST',
      path: '/api/v1/notifications/:id/read',
      pathParams: z.object({ id: Uuid }),
      body: c.noBody(),
      responses: { 204: c.noBody(), ...errorResponses },
    },
    readAll: {
      method: 'POST',
      path: '/api/v1/notifications/read-all',
      body: c.noBody(),
      responses: { 204: c.noBody(), ...errorResponses },
    },
  }),
  /**
   * F-45 weighted store distribution (FR-LEAD-007, D-049). Owner/GM surface:
   * ad spend per store is money data — organization:update both directions.
   */
  distribution: c.router({
    read: {
      method: 'GET',
      path: '/api/v1/distribution',
      query: DistributionQuery,
      responses: { 200: z.object({ items: z.array(DistributionRow.extend({ deviation: z.string() })) }), ...errorResponses },
    },
    putConfig: {
      method: 'PUT',
      path: '/api/v1/distribution/config',
      body: PutDistributionConfigInput,
      responses: { 200: z.object({ items: z.array(DistributionRow) }), ...errorResponses },
    },
    history: {
      method: 'GET',
      path: '/api/v1/distribution/history',
      query: DistributionQuery.omit({ month: true }),
      responses: { 200: z.object({ items: z.array(DistributionRow.extend({ deviation: z.string() })) }), ...errorResponses },
    },
  }),
  /**
   * F-39 lead scoring (leads.md §6). Rule CRUD is an owner/GM power
   * (organization:update — FR-AUTH-004's "manage automation rules");
   * recalculation is lead work. DELETE is hard: a rule is config, not a
   * record; the soft option is PATCH { is_active: false }.
   */
  scoringRules: c.router({
    list: {
      method: 'GET',
      path: '/api/v1/scoring-rules',
      query: ScoringRuleListQuery,
      responses: {
        200: z.object({ items: z.array(LeadScoringRule), next_cursor: z.string().nullable() }),
        ...errorResponses,
      },
    },
    create: {
      method: 'POST',
      path: '/api/v1/scoring-rules',
      body: CreateScoringRuleInput,
      responses: { 201: LeadScoringRule, ...errorResponses },
    },
    update: {
      method: 'PATCH',
      path: '/api/v1/scoring-rules/:id',
      pathParams: z.object({ id: Uuid }),
      body: UpdateScoringRuleInput,
      responses: { 200: LeadScoringRule, ...errorResponses },
    },
    remove: {
      method: 'DELETE',
      path: '/api/v1/scoring-rules/:id',
      pathParams: z.object({ id: Uuid }),
      responses: { 204: c.noBody(), ...errorResponses },
    },
    scoreLead: {
      method: 'POST',
      path: '/api/v1/leads/:id/score',
      pathParams: z.object({ id: Uuid }),
      body: c.noBody(),
      responses: { 200: LeadScoreResult, ...errorResponses },
    },
  }),
  /**
   * F-69 platform admin console, slice 1 (admin-console.md §3/§4/§11).
   * Everything under /api/v1/admin/ is gated by identity (platform_staff), MFA
   * and session age BEFORE any handler runs; non-staff get 404, never 403.
   * Transitions have their own endpoint: the reason, the `restricted` flag,
   * the slug confirmation and the compare-and-swap are transition-specific.
   */
  admin: c.router({
    me: {
      method: 'GET',
      path: '/api/v1/admin/me',
      responses: { 200: AdminMeResponse, ...errorResponses },
    },
    plans: {
      method: 'GET',
      path: '/api/v1/admin/plans',
      responses: { 200: PlanList, ...errorResponses },
    },
    tenants: c.router({
      list: {
        method: 'GET',
        path: '/api/v1/admin/tenants',
        query: AdminTenantListQuery,
        responses: { 200: AdminTenantPage, ...errorResponses },
      },
      /**
       * F-70 provisioning (§4.3): one transaction births the organization,
       * its stores and catalogues, and the owner's invitation. Idempotent on
       * slug: a second call answers 409 `slug_taken` with the existing id in
       * `details[0].message`. `accept_url` is present only when the mailer
       * cannot reach the invitee.
       */
      create: {
        method: 'POST',
        path: '/api/v1/admin/tenants',
        body: ProvisionTenantInput,
        responses: { 201: AdminTenantProvisioned, ...errorResponses },
      },
      get: {
        method: 'GET',
        path: '/api/v1/admin/tenants/:id',
        pathParams: idParams,
        responses: { 200: AdminTenantDetail, ...errorResponses },
      },
      events: {
        method: 'GET',
        path: '/api/v1/admin/tenants/:id/events',
        pathParams: idParams,
        query: AdminTenantEventsQuery,
        responses: { 200: AdminTenantEventsResponse, ...errorResponses },
      },
      update: {
        method: 'PATCH',
        path: '/api/v1/admin/tenants/:id',
        pathParams: idParams,
        body: AdminUpdateTenantInput,
        responses: { 200: AdminTenantDetail, ...errorResponses },
      },
      setStatus: {
        method: 'POST',
        path: '/api/v1/admin/tenants/:id/status',
        pathParams: idParams,
        body: TenantStatusChangeInput,
        responses: { 200: TenantStatusChangeResult, ...errorResponses },
      },
      /** F-70: re-send or correct the owner seat; 409 `owner_exists` once an owner is active. */
      inviteOwner: {
        method: 'POST',
        path: '/api/v1/admin/tenants/:id/owner-invitation',
        pathParams: idParams,
        body: ReissueOwnerInvitationInput,
        responses: { 201: OwnerInvitationReissued, ...errorResponses },
      },
      /** F-71: the target picker — a tenant's active members with a sign-in identity. */
      members: {
        method: 'GET',
        path: '/api/v1/admin/tenants/:id/members',
        pathParams: idParams,
        responses: { 200: AdminTenantMembers, ...errorResponses },
      },
    }),
    staff: c.router({
      list: {
        method: 'GET',
        path: '/api/v1/admin/staff',
        responses: { 200: PlatformStaffList, ...errorResponses },
      },
      grant: {
        method: 'POST',
        path: '/api/v1/admin/staff',
        body: GrantPlatformStaffInput,
        responses: { 201: PlatformStaffGranted, ...errorResponses },
      },
      revoke: {
        method: 'DELETE',
        path: '/api/v1/admin/staff/:userId',
        pathParams: z.object({ userId: Uuid }),
        body: c.noBody(),
        responses: { 204: c.noBody(), ...errorResponses },
      },
    }),
    /**
     * F-71 impersonation with audit (admin-console.md §7, D-072). A session is
     * a register row bound to the staffer's own console session: `start`
     * answers 201 with the row; from then on the same cookie acts as the
     * target in the tenant app until `end`, the 60-minute TTL, or a loss of
     * standing. `end` answers 200 + the closed row (ended_at / end_reason).
     */
    impersonation: c.router({
      start: {
        method: 'POST',
        path: '/api/v1/admin/impersonation-sessions',
        body: StartImpersonationInput,
        responses: { 201: ImpersonationSession, ...errorResponses },
      },
      list: {
        method: 'GET',
        path: '/api/v1/admin/impersonation-sessions',
        query: ImpersonationListQuery,
        responses: { 200: ImpersonationList, ...errorResponses },
      },
      get: {
        method: 'GET',
        path: '/api/v1/admin/impersonation-sessions/:id',
        pathParams: idParams,
        responses: { 200: ImpersonationSessionDetail, ...errorResponses },
      },
      end: {
        method: 'DELETE',
        path: '/api/v1/admin/impersonation-sessions/:id',
        pathParams: idParams,
        body: c.noBody(),
        responses: { 200: ImpersonationSession, ...errorResponses },
      },
    }),
  }),
  /** F-71 §7/§12: the tenant's own view of every support session on it (permission activity:read). */
  supportAccess: c.router({
    list: {
      method: 'GET',
      path: '/api/v1/support-access',
      query: SupportAccessQuery,
      responses: { 200: SupportAccessList, ...errorResponses },
    },
  }),
  /**
   * F-68 tasks — the unified follow-up system (appointments-tasks-
   * communications.md §3.3). A bounded board (200 + truncated) like the
   * appointments console; bulk operations cap at 50 ids and report how
   * many rows actually changed, never how many were asked.
   */
  tasks: c.router({
    list: {
      method: 'GET',
      path: '/api/v1/tasks',
      query: TaskListQuery,
      responses: { 200: TaskListPage, ...errorResponses },
    },
    summary: {
      method: 'GET',
      path: '/api/v1/tasks/summary',
      query: TaskSummaryQuery,
      responses: { 200: TaskSummary, ...errorResponses },
    },
    create: {
      method: 'POST',
      path: '/api/v1/tasks',
      body: CreateTaskInput,
      responses: { 201: Task, ...errorResponses },
    },
    update: {
      method: 'PATCH',
      path: '/api/v1/tasks/:id',
      pathParams: z.object({ id: Uuid }),
      body: UpdateTaskInput,
      responses: { 200: Task, ...errorResponses },
    },
    remove: {
      method: 'DELETE',
      path: '/api/v1/tasks/:id',
      pathParams: z.object({ id: Uuid }),
      body: c.noBody(),
      responses: { 204: c.noBody(), ...errorResponses },
    },
    bulkComplete: {
      method: 'POST',
      path: '/api/v1/tasks/bulk/complete',
      body: BulkCompleteTasksInput,
      responses: { 200: BulkTasksResult, ...errorResponses },
    },
    bulkReassign: {
      method: 'POST',
      path: '/api/v1/tasks/bulk/reassign',
      body: BulkReassignTasksInput,
      responses: { 200: BulkTasksResult, ...errorResponses },
    },
  }),
  /**
   * F-38 appointments — the console's side of what the assistant books.
   *
   * The list is bounded (200 + a truncated flag), not cursor-paginated: the
   * upcoming window is the bound, and a board's whole point is being seen at
   * once. Cancelling is its own endpoint so the reason the 0037 CHECK demands
   * cannot be skipped by routing around it.
   */
  appointments: c.router({
    list: {
      method: 'GET',
      path: '/api/v1/appointments',
      query: AppointmentListQuery,
      responses: {
        200: z.object({ items: z.array(Appointment), truncated: z.boolean() }),
        ...errorResponses,
      },
    },
    create: {
      method: 'POST',
      path: '/api/v1/appointments',
      body: CreateAppointmentInput,
      responses: { 201: Appointment, ...errorResponses },
    },
    update: {
      method: 'PATCH',
      path: '/api/v1/appointments/:id',
      pathParams: z.object({ id: Uuid }),
      body: UpdateAppointmentInput,
      responses: { 200: Appointment, ...errorResponses },
    },
    cancel: {
      method: 'POST',
      path: '/api/v1/appointments/:id/cancel',
      pathParams: z.object({ id: Uuid }),
      body: CancelAppointmentInput,
      responses: { 200: Appointment, ...errorResponses },
    },
  }),
  contacts: c.router({
    create: {
      method: 'POST',
      path: '/api/v1/contacts',
      body: CreateContactInput,
      responses: {
        201: z.object({
          contact: Contact,
          /** Reported, never enforced — see the schema for why. */
          duplicates: z.array(DuplicateMatch),
        }),
        ...errorResponses,
      },
    },
    list: {
      method: 'GET',
      path: '/api/v1/contacts',
      query: ContactListQuery,
      responses: {
        200: z.object({ items: z.array(Contact), next_cursor: z.string().nullable() }),
        ...errorResponses,
      },
    },
    get: {
      method: 'GET',
      path: '/api/v1/contacts/:id',
      pathParams: z.object({ id: Uuid }),
      responses: { 200: Contact, ...errorResponses },
    },
    update: {
      method: 'PATCH',
      path: '/api/v1/contacts/:id',
      pathParams: z.object({ id: Uuid }),
      body: UpdateContactInput,
      responses: { 200: Contact, ...errorResponses },
    },
    /**
     * Fold a duplicate into the record that survives (FR-CON-003).
     *
     * A POST on a static path rather than a PATCH on `/:id`, because this is not
     * an edit to one record: two of them go in, one comes out, and the other
     * stops existing. The response reports what moved so the caller can say so
     * rather than claiming a merge happened and hoping.
     */
    merge: {
      method: 'POST',
      path: '/api/v1/contacts/merge',
      body: MergeContactsInput,
      responses: { 200: MergeContactsResult, ...errorResponses },
    },
  }),
  /**
   * F-21 the agent console (conversation-engine.md §9, api-design.md §6).
   *
   * Note what a client cannot say here: where to send. The destination lives on
   * the conversation, so no request body carries a phone number — §4's "no tool
   * sends free-form messages to arbitrary numbers" is a property of the API, not
   * a rule the assistant is asked to follow.
   */
  conversations: c.router({
    list: {
      method: 'GET',
      path: '/api/v1/conversations',
      query: ConversationListQuery,
      responses: {
        200: z.object({ items: z.array(Conversation), next_cursor: z.string().nullable() }),
        ...errorResponses,
      },
    },
    get: {
      method: 'GET',
      path: '/api/v1/conversations/:id',
      pathParams: z.object({ id: Uuid }),
      responses: {
        200: z.object({
          conversation: Conversation,
          /** What the assistant thought, newest first. Advisory, never authority. */
          analysis: z.array(ConversationAnalysisRecord),
        }),
        ...errorResponses,
      },
    },
    messages: {
      method: 'GET',
      path: '/api/v1/conversations/:id/messages',
      pathParams: z.object({ id: Uuid }),
      query: MessageListQuery,
      responses: {
        200: z.object({ items: z.array(Message), next_cursor: z.string().nullable() }),
        ...errorResponses,
      },
    },
    /**
     * An agent replies. Runs the same compliance gate and the same outbound
     * guard as the assistant does — a person typing it changes who is
     * accountable, not whether the message is lawful.
     */
    reply: {
      method: 'POST',
      path: '/api/v1/conversations/:id/messages',
      pathParams: z.object({ id: Uuid }),
      body: SendAgentMessageInput,
      responses: { 200: SendResult, ...errorResponses },
    },
    /** Take it from the assistant, or hand it to a colleague. */
    takeover: {
      method: 'POST',
      path: '/api/v1/conversations/:id/takeover',
      pathParams: z.object({ id: Uuid }),
      body: TakeoverInput,
      responses: { 200: Conversation, ...errorResponses },
    },
    close: {
      method: 'POST',
      path: '/api/v1/conversations/:id/close',
      pathParams: z.object({ id: Uuid }),
      body: CloseConversationInput,
      responses: { 200: Conversation, ...errorResponses },
    },
  }),
  /** F-10 activity trail (ADR-009): one entity's history, or the org's recent. */
  activity: c.router({
    list: {
      method: 'GET',
      path: '/api/v1/activity',
      query: ActivityListQuery,
      responses: { 200: paginated(ActivityEvent), ...errorResponses },
    },
  }),
  commissions: c.router({
    list: {
      method: 'GET',
      path: '/api/v1/commissions',
      query: CommissionListQuery,
      responses: { 200: paginated(Commission), ...errorResponses },
    },
  }),
  /** F-07 inventory: the cars a store owns; a deal points at one. */
  vehicles: crudRouter('vehicles', Vehicle, CreateVehicleInput, UpdateVehicleInput, VehicleListQuery),
  /** F-05 desking: the A-06 money engine behind /api/v1 (13-province tax,
   * amortization, gross). `calculate` is pure preview; deals persist it. */
  deals: c.router({
    calculate: {
      method: 'POST',
      path: '/api/v1/deals/calculate',
      body: CalculateDealInput,
      responses: { 200: DeskingOutputs, ...errorResponses },
    },
    create: {
      method: 'POST',
      path: '/api/v1/deals',
      body: CreateDealInput,
      responses: { 201: Deal, ...errorResponses },
    },
    get: {
      method: 'GET',
      path: '/api/v1/deals/:id',
      pathParams: z.object({ id: Uuid }),
      responses: { 200: Deal, ...errorResponses },
    },
    list: {
      method: 'GET',
      path: '/api/v1/deals',
      query: DealListQuery,
      responses: { 200: paginated(Deal), ...errorResponses },
    },
    update: {
      method: 'PATCH',
      path: '/api/v1/deals/:id',
      pathParams: z.object({ id: Uuid }),
      body: UpdateDealInput,
      responses: { 200: Deal, ...errorResponses },
    },
  }),
  /**
   * F-08 delivery checklist: the gate between Signed and Delivered. A deal's
   * items are snapshot from its store's template when the deal is created, so
   * later policy edits never rewrite a deal in flight.
   */
  checklist: c.router({
    /** The deal's items plus whether it may be delivered at all. */
    forDeal: {
      method: 'GET',
      path: '/api/v1/deals/:id/checklist',
      pathParams: z.object({ id: Uuid }),
      responses: {
        200: z.object({ items: z.array(DealChecklistItem), readiness: ChecklistReadiness }),
        ...errorResponses,
      },
    },
    /**
     * Tick, untick or waive one item. 403 when a salesperson tries to waive or
     * to sign off the safety inspection; 409 `deal_delivered` once the deal has
     * been delivered, because the checklist is then the record of why.
     */
    updateItem: {
      method: 'PATCH',
      path: '/api/v1/deals/:id/checklist/:code',
      pathParams: z.object({ id: Uuid, code: ChecklistCode }),
      body: UpdateChecklistItemInput,
      responses: { 200: DealChecklistItem, ...errorResponses },
    },
    /** The store's policy: which items it requires (D-020). */
    template: {
      method: 'GET',
      path: '/api/v1/stores/:id/checklist-template',
      pathParams: z.object({ id: Uuid }),
      responses: { 200: z.object({ items: z.array(ChecklistTemplate) }), ...errorResponses },
    },
    /** Owner/GM only. Switching the safety inspection off is refused (422). */
    updateTemplate: {
      method: 'PATCH',
      path: '/api/v1/stores/:id/checklist-template/:code',
      pathParams: z.object({ id: Uuid, code: ChecklistCode }),
      body: UpdateChecklistTemplateInput,
      responses: { 200: ChecklistTemplate, ...errorResponses },
    },
  }),
  /** F-04 team members: membership joined to user, add-by-email, roles, revoke. */
  members: c.router({
    add: {
      method: 'POST',
      path: '/api/v1/members',
      body: AddMemberInput,
      // MemberAdded = Member + `reinstated` (revived vs newly created).
      responses: { 201: MemberAdded, ...errorResponses },
    },
    list: {
      method: 'GET',
      path: '/api/v1/members',
      query: MemberListQuery,
      responses: { 200: paginated(Member), ...errorResponses },
    },
    update: {
      method: 'PATCH',
      path: '/api/v1/members/:id',
      pathParams: z.object({ id: Uuid }),
      body: UpdateMemberInput,
      responses: { 200: Member, ...errorResponses },
    },
  }),
  intakeKeys: c.router({
    create: {
      method: 'POST',
      path: '/api/v1/intake-keys',
      body: CreateIntakeKeyInput,
      // 201 returns the raw secret ONCE (IntakeKeyCreated); list/get never do.
      responses: { 201: IntakeKeyCreated, ...errorResponses },
    },
    list: {
      method: 'GET',
      path: '/api/v1/intake-keys',
      query: StoreListQuery,
      responses: { 200: paginated(IntakeKey), ...errorResponses },
    },
    revoke: {
      method: 'DELETE',
      path: '/api/v1/intake-keys/:id',
      pathParams: z.object({ id: Uuid }),
      body: c.noBody(),
      responses: { 204: c.noBody(), ...errorResponses },
    },
  }),
});
