import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  paginated,
  TenantConnector,
  type CreateConnectorInputT,
  type UpdateConnectorInputT,
} from '@dealpilot/schemas';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';

const Page = paginated(TenantConnector);

export const connectorKeys = {
  all: ['connectors'] as const,
  list: (orgId: string | undefined) => ['connectors', 'list', orgId ?? 'single-org'] as const,
};

export function useConnectors(orgId?: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: connectorKeys.list(orgId),
    enabled: opts?.enabled ?? true,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.connectors.list, {
        query: { limit: 100, organization_id: orgId },
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      return Page.parse(res.body);
    },
  });
}

export function useCreateConnector() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateConnectorInputT) => {
      const res = await apiRequest(routes.connectors.create, { body: input });
      if (res.status !== 201) fail(res.status, res.body);
      return TenantConnector.parse(res.body);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: connectorKeys.all }),
  });
}

export function useUpdateConnector() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: UpdateConnectorInputT & { id: string }) => {
      const res = await apiRequest(routes.connectors.update, { params: { id }, body: input });
      if (res.status !== 200) fail(res.status, res.body);
      return TenantConnector.parse(res.body);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: connectorKeys.all }),
  });
}

export function useDeleteConnector() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest(routes.connectors.remove, { params: { id } });
      if (res.status !== 204) fail(res.status, res.body);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: connectorKeys.all }),
  });
}
