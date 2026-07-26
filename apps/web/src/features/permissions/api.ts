import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  PermissionMatrix,
  UpdateRolePermissionsInput,
  UpdateUserPermissionInput,
} from '@dealpilot/schemas';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';

export function usePermissionMatrix(orgId?: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['permissions', 'matrix', orgId ?? 'single-org'] as const,
    enabled: opts?.enabled ?? true,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.permissions.matrix, {
        query: { organization_id: orgId },
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      return PermissionMatrix.parse(res.body);
    },
  });
}

/** Saving a role replaces its WHOLE set — anything absent is revoked. */
export function useSetRolePermissions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: z.input<typeof UpdateRolePermissionsInput>) => {
      const res = await apiRequest(routes.permissions.setRole, { body });
      if (res.status !== 200) fail(res.status, res.body);
      return PermissionMatrix.parse(res.body);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['permissions'] }),
  });
}

export function useSetUserPermission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: z.input<typeof UpdateUserPermissionInput>) => {
      const res = await apiRequest(routes.permissions.setUser, { body });
      if (res.status !== 204) fail(res.status, res.body);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['permissions'] }),
  });
}
