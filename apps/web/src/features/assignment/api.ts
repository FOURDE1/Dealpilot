import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LeadAssignmentRule,
  paginated,
  type CreateAssignmentRuleInputT,
  type UpdateAssignmentRuleInputT,
} from '@dealpilot/schemas';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';
import { leadKeys } from '../leads/api.js';

const PaginatedRules = paginated(LeadAssignmentRule);

export const assignmentKeys = {
  all: ['assignment-rules'] as const,
  list: (orgId: string | undefined) => ['assignment-rules', 'list', orgId ?? 'single-org'] as const,
};

export function useAssignmentRules(orgId?: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: assignmentKeys.list(orgId),
    enabled: opts?.enabled ?? true,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.assignmentRules.list, {
        query: { limit: 100, organization_id: orgId },
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      return PaginatedRules.parse(res.body);
    },
  });
}

export function useCreateAssignmentRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateAssignmentRuleInputT) => {
      const res = await apiRequest(routes.assignmentRules.create, { body: input });
      if (res.status !== 201) fail(res.status, res.body);
      return LeadAssignmentRule.parse(res.body);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: assignmentKeys.all }),
  });
}

export function useUpdateAssignmentRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: UpdateAssignmentRuleInputT & { id: string }) => {
      const res = await apiRequest(routes.assignmentRules.update, { params: { id }, body: input });
      if (res.status !== 200) fail(res.status, res.body);
      return LeadAssignmentRule.parse(res.body);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: assignmentKeys.all }),
  });
}

export function useDeleteAssignmentRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest(routes.assignmentRules.remove, { params: { id } });
      if (res.status !== 204) fail(res.status, res.body);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: assignmentKeys.all }),
  });
}

/** Ask the engine to route one lead now; refresh whatever shows assigned_to. */
export function useAssignLead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (leadId: string) => {
      const res = await apiRequest(routes.assignmentRules.assignLead, { params: { id: leadId } });
      if (res.status !== 200) fail(res.status, res.body);
      return res.body;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: leadKeys.all }),
  });
}
