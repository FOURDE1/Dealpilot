import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ErrorEnvelope,
  Organization,
  Store,
  paginated,
  type CreateOrganizationInputT,
  type CreateStoreInputT,
  type UpdateOrganizationInputT,
  type UpdateStoreInputT,
} from '@dealpilot/schemas';
import { ApiError, apiRequest, routes } from '../../shared/api/client.js';

export { ApiError } from '../../shared/api/client.js';

const PaginatedOrganizations = paginated(Organization);
const PaginatedStores = paginated(Store);

export const orgKeys = {
  all: ['organizations'] as const,
  detail: (id: string) => ['organizations', id] as const,
  stores: (orgId: string) => ['organizations', orgId, 'stores'] as const,
};

function fail(status: number, body: unknown): never {
  const parsed = ErrorEnvelope.safeParse(body);
  const fieldPath = parsed.success ? parsed.data.error.details?.[0]?.path : undefined;
  throw new ApiError(status, fieldPath);
}

export function useOrganizations() {
  return useQuery({
    queryKey: orgKeys.all,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.organizations.list, { query: { limit: 100 }, signal });
      if (res.status !== 200) fail(res.status, res.body);
      return PaginatedOrganizations.parse(res.body);
    },
  });
}

export function useOrganization(id: string) {
  return useQuery({
    queryKey: orgKeys.detail(id),
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.organizations.get, { params: { id }, signal });
      if (res.status !== 200) fail(res.status, res.body);
      return Organization.parse(res.body);
    },
  });
}

export function useCreateOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateOrganizationInputT) => {
      const res = await apiRequest(routes.organizations.create, { body });
      if (res.status !== 201) fail(res.status, res.body);
      return Organization.parse(res.body);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orgKeys.all }),
  });
}

export function useUpdateOrganization(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: UpdateOrganizationInputT) => {
      const res = await apiRequest(routes.organizations.update, { params: { id }, body });
      if (res.status !== 200) fail(res.status, res.body);
      return Organization.parse(res.body);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: orgKeys.all }),
  });
}

export function useStores(orgId: string) {
  return useQuery({
    queryKey: orgKeys.stores(orgId),
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.stores.list, {
        query: { organization_id: orgId, limit: 100 },
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      return PaginatedStores.parse(res.body);
    },
  });
}

export function useStore(orgId: string, storeId: string) {
  return useQuery({
    // Store reads are org-scoped in the cache even though GET is by id.
    queryKey: [...orgKeys.stores(orgId), storeId],
    enabled: storeId !== '',
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.stores.get, { params: { id: storeId }, signal });
      if (res.status !== 200) fail(res.status, res.body);
      return Store.parse(res.body);
    },
  });
}

export function useCreateStore(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateStoreInputT) => {
      const res = await apiRequest(routes.stores.create, { body });
      if (res.status !== 201) fail(res.status, res.body);
      return Store.parse(res.body);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orgKeys.stores(orgId) }),
  });
}

export function useUpdateStore(orgId: string, storeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: UpdateStoreInputT) => {
      const res = await apiRequest(routes.stores.update, { params: { id: storeId }, body });
      if (res.status !== 200) fail(res.status, res.body);
      return Store.parse(res.body);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orgKeys.stores(orgId) }),
  });
}
