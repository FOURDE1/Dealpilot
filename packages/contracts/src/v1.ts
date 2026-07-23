import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import {
  CreateLeadInput,
  CreateMembershipInput,
  CreateOrganizationInput,
  CreateStoreInput,
  CreateUserInput,
  CursorQuery,
  ErrorEnvelope,
  Lead,
  Membership,
  Organization,
  Store,
  UpdateLeadInput,
  UpdateMembershipInput,
  UpdateOrganizationInput,
  UpdateStoreInput,
  UpdateUserInput,
  User,
  Uuid,
  paginated,
} from '@readyloans/schemas';

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
>(
  path: string,
  entity: Entity,
  createInput: CreateInput,
  updateInput: UpdateInput,
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
      query: CursorQuery,
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
  organizations: crudRouter('organizations', Organization, CreateOrganizationInput, UpdateOrganizationInput),
  stores: crudRouter('stores', Store, CreateStoreInput, UpdateStoreInput),
  users: crudRouter('users', User, CreateUserInput, UpdateUserInput),
  memberships: crudRouter('memberships', Membership, CreateMembershipInput, UpdateMembershipInput),
  leads: crudRouter('leads', Lead, CreateLeadInput, UpdateLeadInput),
});
