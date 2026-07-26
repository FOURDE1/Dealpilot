import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  PermissionMatrix,
  UpdateRolePermissionsInput,
  UpdateUserPermissionInput,
  UserPermissionOverride,
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
    onSuccess: (matrix, body) => {
      // The PUT answers with the authoritative matrix — write it straight in.
      queryClient.setQueriesData({ queryKey: ['permissions', 'matrix'] }, () => matrix);
      void queryClient.invalidateQueries({ queryKey: ['permissions'] });
      void body;
    },
  });
}

/** The exceptions that exist — so they can be seen, audited and cleared. */
export function useUserOverrides(orgId?: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['permissions', 'overrides', orgId ?? 'single-org'] as const,
    enabled: opts?.enabled ?? true,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.permissions.overrides, {
        query: { organization_id: orgId },
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      return z.object({ items: z.array(UserPermissionOverride) }).parse(res.body).items;
    },
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
