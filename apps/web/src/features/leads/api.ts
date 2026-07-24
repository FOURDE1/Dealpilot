import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ErrorEnvelope,
  Lead,
  paginated,
  type CreateLeadInputT,
  type UpdateLeadInputT,
} from '@dealpilot/schemas';
import { ApiError, apiRequest, routes } from '../../shared/api/client.js';

const PaginatedLeads = paginated(Lead);

export const leadKeys = {
  all: ['leads'] as const,
  list: (orgId: string | undefined) => ['leads', 'list', orgId ?? 'single-org'] as const,
  detail: (id: string) => ['leads', id] as const,
};

function fail(status: number, body: unknown): never {
  const parsed = ErrorEnvelope.safeParse(body);
  throw new ApiError(status, parsed.success ? parsed.data.error.details?.[0]?.path : undefined);
}

export function useLeads(orgId?: string) {
  return useQuery({
    queryKey: leadKeys.list(orgId),
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.leads.list, {
        query: { limit: 100, organization_id: orgId },
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      return PaginatedLeads.parse(res.body);
    },
  });
}

export function useLead(id: string) {
  return useQuery({
    queryKey: leadKeys.detail(id),
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.leads.get, { params: { id }, signal });
      if (res.status !== 200) fail(res.status, res.body);
      return Lead.parse(res.body);
    },
  });
}

export function useCreateLead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateLeadInputT) => {
      const res = await apiRequest(routes.leads.create, { body });
      if (res.status !== 201) fail(res.status, res.body);
      return Lead.parse(res.body);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: leadKeys.all }),
  });
}

export function useUpdateLead(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: UpdateLeadInputT) => {
      const res = await apiRequest(routes.leads.update, { params: { id }, body });
      if (res.status !== 200) fail(res.status, res.body);
      return Lead.parse(res.body);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: leadKeys.all }),
  });
}
