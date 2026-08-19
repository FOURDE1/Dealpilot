import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LeadScoringRule,
  paginated,
  type CreateScoringRuleInputT,
  type UpdateScoringRuleInputT,
} from '@dealpilot/schemas';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';
import { leadKeys } from '../leads/api.js';

const PaginatedRules = paginated(LeadScoringRule);

export const scoringKeys = {
  all: ['scoring-rules'] as const,
  list: (orgId: string | undefined) => ['scoring-rules', 'list', orgId ?? 'single-org'] as const,
};

export function useScoringRules(orgId?: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: scoringKeys.list(orgId),
    enabled: opts?.enabled ?? true,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.scoringRules.list, {
        query: { limit: 100, organization_id: orgId },
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      return PaginatedRules.parse(res.body);
    },
  });
}

export function useCreateScoringRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateScoringRuleInputT) => {
      const res = await apiRequest(routes.scoringRules.create, { body: input });
      if (res.status !== 201) fail(res.status, res.body);
      return LeadScoringRule.parse(res.body);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: scoringKeys.all }),
  });
}

export function useUpdateScoringRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: UpdateScoringRuleInputT & { id: string }) => {
      const res = await apiRequest(routes.scoringRules.update, { params: { id }, body: input });
      if (res.status !== 200) fail(res.status, res.body);
      return LeadScoringRule.parse(res.body);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: scoringKeys.all }),
  });
}

export function useDeleteScoringRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest(routes.scoringRules.remove, { params: { id } });
      if (res.status !== 204) fail(res.status, res.body);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: scoringKeys.all }),
  });
}

/** Re-run the engine for one lead and refresh every list that shows the number. */
export function useRecalculateLead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (leadId: string) => {
      const res = await apiRequest(routes.scoringRules.scoreLead, { params: { id: leadId } });
      if (res.status !== 200) fail(res.status, res.body);
      return res.body;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: leadKeys.all }),
  });
}
