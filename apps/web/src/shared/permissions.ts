import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { Permission, type PermissionT } from '@dealpilot/schemas';
import { apiRequest, failFromResponse as fail, routes } from './api/client.js';

const Mine = z.object({ permissions: z.array(Permission) });

/**
 * A-13: the signed-in person's effective permissions (overrides applied).
 * Buttons hide on this; the server stays the authority — keep handling 403.
 */
export function usePermissionsMine(orgId?: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['permissions', 'mine', orgId ?? 'single-org'] as const,
    enabled: opts?.enabled ?? true,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.permissions.mine, {
        query: { organization_id: orgId },
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      return new Set<PermissionT>(Mine.parse(res.body).permissions);
    },
  });
}

export function can(mine: Set<PermissionT> | undefined, permission: PermissionT): boolean {
  return mine?.has(permission) ?? false;
}
