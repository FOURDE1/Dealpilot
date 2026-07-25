import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Commission,
  PayPlan,
  paginated,
  type CreatePayPlanInputT,
  type UpdatePayPlanInputT,
} from '@dealpilot/schemas';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';

const PaginatedPayPlans = paginated(PayPlan);
const PaginatedCommissions = paginated(Commission);

export const commissionKeys = {
  plans: (orgId: string | undefined) => ['pay-plans', orgId] as const,
  plan: (orgId: string | undefined, userId: string) => ['pay-plans', orgId, userId] as const,
  lines: (orgId: string | undefined) => ['commissions', orgId] as const,
};

/** The member's current plan (the newest active one), or null. */
export function usePayPlan(orgId: string | undefined, userId: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: commissionKeys.plan(orgId, userId),
    enabled: (opts?.enabled ?? true) && userId !== '',
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.payPlans.list, {
        query: { organization_id: orgId, user_id: userId, limit: 10 },
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      const parsed = PaginatedPayPlans.parse(res.body);
      // The API answers with the CALLER's plans when the caller may not read
      // others' pay — never present those as the requested member's plan.
      return parsed.items.find((p) => p.active && p.user_id === userId) ?? null;
    },
  });
}

export function useUpsertPayPlan(orgId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreatePayPlanInputT) => {
      const res = await apiRequest(routes.payPlans.upsert, { body });
      if (res.status !== 201) fail(res.status, res.body);
      return PayPlan.parse(res.body);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pay-plans', orgId] }),
  });
}

export function useUpdatePayPlan(orgId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: UpdatePayPlanInputT }) => {
      const res = await apiRequest(routes.payPlans.update, { params: { id }, body });
      if (res.status !== 200) fail(res.status, res.body);
      return PayPlan.parse(res.body);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pay-plans', orgId] }),
  });
}

/** Commission lines — the server scopes: managers see the org, others themselves. */
export function useCommissions(orgId?: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: commissionKeys.lines(orgId),
    enabled: opts?.enabled ?? true,
    queryFn: async ({ signal }) => {
      // Pay data: follow cursors (bounded) — a month total from one page is a
      // payroll dispute waiting to happen.
      const items = [];
      let cursor: string | undefined;
      for (let page = 0; page < 3; page++) {
        const res = await apiRequest(routes.commissions.list, {
          query: { organization_id: orgId, limit: 100, cursor },
          signal,
        });
        if (res.status !== 200) fail(res.status, res.body);
        const parsed = PaginatedCommissions.parse(res.body);
        items.push(...parsed.items);
        if (!parsed.next_cursor) return { items, truncated: false };
        cursor = parsed.next_cursor;
      }
      return { items, truncated: true };
    },
  });
}
