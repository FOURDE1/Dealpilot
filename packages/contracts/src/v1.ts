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
