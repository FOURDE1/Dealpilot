import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import {
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
