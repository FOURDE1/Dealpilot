import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Vehicle,
  paginated,
  type CreateVehicleInputT,
  type UpdateVehicleInputT,
  type VehicleT,
} from '@dealpilot/schemas';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';

const PaginatedVehicles = paginated(Vehicle);

export const vehicleKeys = {
  all: ['vehicles'] as const,
  list: (orgId: string | undefined, filters?: { storeId?: string; dealStatus?: VehicleT['deal_status'] }) =>
    ['vehicles', 'list', orgId ?? 'single-org', filters?.storeId ?? 'all', filters?.dealStatus ?? 'all'] as const,
  detail: (id: string) => ['vehicles', id] as const,
};

export function useVehicles(
  orgId?: string,
  opts?: { enabled?: boolean; storeId?: string; dealStatus?: VehicleT['deal_status'] },
) {
  return useQuery({
    queryKey: vehicleKeys.list(orgId, { storeId: opts?.storeId, dealStatus: opts?.dealStatus }),
    enabled: opts?.enabled ?? true,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.vehicles.list, {
        query: {
          limit: 100,
          organization_id: orgId,
          store_id: opts?.storeId,
          deal_status: opts?.dealStatus,
        },
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      return PaginatedVehicles.parse(res.body);
    },
  });
}

export function useVehicle(id: string) {
  return useQuery({
    queryKey: vehicleKeys.detail(id),
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.vehicles.get, { params: { id }, signal });
      if (res.status !== 200) fail(res.status, res.body);
      return Vehicle.parse(res.body);
    },
  });
}

export function useCreateVehicle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateVehicleInputT) => {
      const res = await apiRequest(routes.vehicles.create, { body });
      if (res.status !== 201) fail(res.status, res.body);
      return Vehicle.parse(res.body);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: vehicleKeys.all }),
  });
}

export function useUpdateVehicle(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: UpdateVehicleInputT) => {
      const res = await apiRequest(routes.vehicles.update, { params: { id }, body });
      if (res.status !== 200) fail(res.status, res.body);
      return Vehicle.parse(res.body);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: vehicleKeys.all }),
  });
}
