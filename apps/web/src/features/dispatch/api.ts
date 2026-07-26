import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  ChaserVehicle,
  CreateChaserInput,
  CreateDispatchInput,
  CreateDriverCompanyInput,
  CreatePlateInput,
  DealerPlate,
  DispatchAssignment,
  DriverCompany,
  UpdateDispatchInput,
  UpdateDriverCompanyInput,
  paginated,
  type DispatchAssignmentT,
} from '@dealpilot/schemas';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';

const PaginatedDispatch = paginated(DispatchAssignment);
const PaginatedCompanies = paginated(DriverCompany);
const PaginatedChasers = paginated(ChaserVehicle);
const PaginatedPlates = paginated(DealerPlate);

export const dispatchKeys = {
  all: ['dispatch'] as const,
  list: (orgId: string | undefined, conflictsOnly: boolean) =>
    ['dispatch', 'list', orgId ?? 'single-org', conflictsOnly] as const,
  companies: (orgId: string | undefined) => ['driver-companies', orgId ?? 'single-org'] as const,
  fleet: (storeId: string) => ['fleet', storeId] as const,
};

export function useDispatchList(
  orgId?: string,
  opts?: { enabled?: boolean; conflictsOnly?: boolean },
) {
  return useQuery({
    queryKey: dispatchKeys.list(orgId, opts?.conflictsOnly ?? false),
    enabled: opts?.enabled ?? true,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.dispatch.list, {
        query: {
          organization_id: orgId,
          limit: 100,
          ...(opts?.conflictsOnly ? { conflicts_only: 'true' } : {}),
        },
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      return PaginatedDispatch.parse(res.body);
    },
  });
}

export function useBookDispatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: z.input<typeof CreateDispatchInput>) => {
      const res = await apiRequest(routes.dispatch.book, { body });
      if (res.status !== 201) fail(res.status, res.body);
      return DispatchAssignment.parse(res.body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dispatchKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['fleet'] });
      void queryClient.invalidateQueries({ queryKey: ['activity'] });
    },
  });
}

export function useUpdateDispatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: z.input<typeof UpdateDispatchInput> }) => {
      const res = await apiRequest(routes.dispatch.update, { params: { id }, body });
      if (res.status !== 200) fail(res.status, res.body);
      return DispatchAssignment.parse(res.body);
    },
    onSuccess: (updated: DispatchAssignmentT) => {
      queryClient.setQueriesData(
        { queryKey: ['dispatch', 'list'] },
        (old: { items: DispatchAssignmentT[] } | undefined) =>
          old ? { ...old, items: old.items.map((d) => (d.id === updated.id ? updated : d)) } : old,
      );
      void queryClient.invalidateQueries({ queryKey: dispatchKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['fleet'] });
      void queryClient.invalidateQueries({ queryKey: ['activity'] });
    },
  });
}

export function useResendDispatchEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest(routes.dispatch.resend, { params: { id } });
      if (res.status !== 200) fail(res.status, res.body);
      return DispatchAssignment.parse(res.body);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: dispatchKeys.all }),
  });
}

export function useDriverCompanies(orgId?: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: dispatchKeys.companies(orgId),
    enabled: opts?.enabled ?? true,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.driverCompanies.list, {
        query: { organization_id: orgId, limit: 100 },
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      return PaginatedCompanies.parse(res.body);
    },
  });
}

export function useCreateDriverCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: z.input<typeof CreateDriverCompanyInput>) => {
      const res = await apiRequest(routes.driverCompanies.create, { body });
      if (res.status !== 201) fail(res.status, res.body);
      return DriverCompany.parse(res.body);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['driver-companies'] }),
  });
}

export function useUpdateDriverCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: z.input<typeof UpdateDriverCompanyInput> }) => {
      const res = await apiRequest(routes.driverCompanies.update, { params: { id }, body });
      if (res.status !== 200) fail(res.status, res.body);
      return DriverCompany.parse(res.body);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['driver-companies'] }),
  });
}

/** Store fleet: chasers + plates share one refresh scope. */
export function useFleet(storeId: string) {
  return useQuery({
    queryKey: dispatchKeys.fleet(storeId),
    enabled: storeId !== '',
    queryFn: async ({ signal }) => {
      const [chasers, plates] = await Promise.all([
        apiRequest(routes.chasers.list, { query: { store_id: storeId, limit: 100 }, signal }),
        apiRequest(routes.plates.list, { query: { store_id: storeId, limit: 100 }, signal }),
      ]);
      if (chasers.status !== 200) fail(chasers.status, chasers.body);
      if (plates.status !== 200) fail(plates.status, plates.body);
      return {
        chasers: PaginatedChasers.parse(chasers.body).items,
        plates: PaginatedPlates.parse(plates.body).items,
      };
    },
  });
}

export function useAddChaser(storeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: z.input<typeof CreateChaserInput>) => {
      const res = await apiRequest(routes.chasers.create, { body });
      if (res.status !== 201) fail(res.status, res.body);
      return ChaserVehicle.parse(res.body);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: dispatchKeys.fleet(storeId) }),
  });
}

export function useAddPlate(storeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: z.input<typeof CreatePlateInput>) => {
      const res = await apiRequest(routes.plates.create, { body });
      if (res.status !== 201) fail(res.status, res.body);
      return DealerPlate.parse(res.body);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: dispatchKeys.fleet(storeId) }),
  });
}
