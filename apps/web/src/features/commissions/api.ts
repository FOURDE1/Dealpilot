import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Commission,
  CommissionClawback,
  PayPlan,
  paginated,
  type CreatePayPlanInputT,
  type FlagClawbackInputT,
  type UpdatePayPlanInputT,
} from '@dealpilot/schemas';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';

const PaginatedPayPlans = paginated(PayPlan);
const PaginatedCommissions = paginated(Commission);
const PaginatedClawbacks = paginated(CommissionClawback);

export const commissionKeys = {
  plans: (orgId: string | undefined) => ['pay-plans', orgId] as const,
  plan: (orgId: string | undefined, userId: string) => ['pay-plans', orgId, userId] as const,
  lines: (orgId: string | undefined) => ['commissions', orgId] as const,
  clawbacks: (orgId: string | undefined) => ['commission-clawbacks', orgId] as const,
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

/**
 * F-79 clawback lifecycle rows. Self-filtered like useCommissions: the server
 * clamps to the caller's own lines unless they hold commission:read_all, so a
 * salesperson still sees the badge on their own flagged line. Pass the SAME
 * multiOrg-aware value the page hands useCommissions (multiOrg ? orgId :
 * undefined) — a single-org tenant's live key is ['commission-clawbacks',
 * undefined], and a mismatched key is an invalidation that never lands (A4).
 */
export function useClawbacks(orgId?: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: commissionKeys.clawbacks(orgId),
    enabled: opts?.enabled ?? true,
    queryFn: async ({ signal }) => {
      const items = [];
      let cursor: string | undefined;
      for (let page = 0; page < 3; page++) {
        const res = await apiRequest(routes.commissionClawbacks.list, {
          query: { organization_id: orgId, limit: 100, cursor },
          signal,
        });
        if (res.status !== 200) fail(res.status, res.body);
        const parsed = PaginatedClawbacks.parse(res.body);
        items.push(...parsed.items);
        if (!parsed.next_cursor) return { items, truncated: false };
        cursor = parsed.next_cursor;
      }
      return { items, truncated: true };
    },
  });
}

/** Flag a line for reversal — writes NO money; the confirm below does. */
export function useFlagClawback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: FlagClawbackInputT) => {
      const res = await apiRequest(routes.commissionClawbacks.flag, { body });
      if (res.status !== 201) fail(res.status, res.body);
      return CommissionClawback.parse(res.body);
    },
    // PREFIX invalidation (A4): matches ['commission-clawbacks', undefined]
    // AND ['commission-clawbacks', '<uuid>'] — the single-org tenant's live
    // key carries undefined, so a uuid-keyed invalidation would never land.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['commission-clawbacks'] }),
  });
}

/** Confirm a flagged clawback — the server derives the negative line from the STORED row. */
export function useConfirmClawback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest(routes.commissionClawbacks.confirm, { params: { id } });
      if (res.status !== 200) fail(res.status, res.body);
      return CommissionClawback.parse(res.body);
    },
    onSuccess: () => {
      // PREFIX ['commissions'] (A4), never commissionKeys.lines(orgId) with a
      // uuid: the page's live key is ['commissions', undefined] in every
      // single-org tenant, and the new negative line + month-total drop must
      // re-render without a navigation.
      void queryClient.invalidateQueries({ queryKey: ['commissions'] });
      void queryClient.invalidateQueries({ queryKey: ['commission-clawbacks'] });
    },
  });
}
