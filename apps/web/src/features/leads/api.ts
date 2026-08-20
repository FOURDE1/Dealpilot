import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BeBackQueue, Lead, paginated, type BeBackQueryT, type CreateLeadInputT, type UpdateLeadInputT } from '@dealpilot/schemas';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';

const PaginatedLeads = paginated(Lead);

export const leadKeys = {
  all: ['leads'] as const,
  list: (orgId: string | undefined) => ['leads', 'list', orgId ?? 'single-org'] as const,
  detail: (id: string) => ['leads', id] as const,
};

export function useLeads(orgId?: string, opts?: { enabled?: boolean; assignedTo?: string }) {
  return useQuery({
    queryKey: [...leadKeys.list(orgId), opts?.assignedTo ?? 'all'],
    enabled: opts?.enabled ?? true,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.leads.list, {
        query: { limit: 100, organization_id: orgId, assigned_to: opts?.assignedTo },
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      return PaginatedLeads.parse(res.body);
    },
  });
}

/**
 * Bounded multi-page fetch just for id→name mapping (kanban cards): one page
 * of newest leads misses older leads' names entirely.
 */
export function useLeadNames(orgId?: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: [...leadKeys.list(orgId), 'names'],
    enabled: opts?.enabled ?? true,
    queryFn: async ({ signal }) => {
      const items = [];
      let cursor: string | undefined;
      for (let page = 0; page < 3; page++) {
        const res = await apiRequest(routes.leads.list, {
          query: { limit: 100, organization_id: orgId, cursor },
          signal,
        });
        if (res.status !== 200) fail(res.status, res.body);
        const parsed = PaginatedLeads.parse(res.body);
        items.push(...parsed.items);
        if (!parsed.next_cursor) break;
        cursor = parsed.next_cursor;
      }
      return items;
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: leadKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['activity'] });
    },
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: leadKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['activity'] });
    },
  });
}

/** F-52 be-back queue (leads.md §9): dormant leads ranked for another try. */
export function useBeBackQueue(
  args: { orgId?: string | undefined; sort: BeBackQueryT['sort']; q: string },
  opts?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ['beback', args.orgId ?? 'single-org', args.sort, args.q],
    enabled: opts?.enabled ?? true,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.beBack.queue, {
        query: {
          organization_id: args.orgId,
          sort: args.sort,
          q: args.q.trim() === '' ? undefined : args.q.trim(),
          limit: 100,
        },
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      return BeBackQueue.parse(res.body);
    },
  });
}

/**
 * Reactivation IS the ordinary status PATCH (leads.md §9) — one write path.
 * Separate from useUpdateLead only to invalidate the queue and to key
 * pending state per card rather than per page.
 */
export function useReactivateLead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest(routes.leads.update, { params: { id }, body: { status: 'contacted' } });
      if (res.status !== 200) fail(res.status, res.body);
      return Lead.parse(res.body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['beback'] });
      void queryClient.invalidateQueries({ queryKey: leadKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['activity'] });
    },
  });
}
