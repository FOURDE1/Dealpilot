import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  Deal,
  DeskingOutputs,
  UpdateDealInput,
  paginated,
  type CalculateDealInputT,
  type CreateDealInputT,
  type DealT,
  type UpdateDealInputT,
} from '@dealpilot/schemas';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';

const PaginatedDeals = paginated(Deal);

export const dealKeys = {
  all: ['deals'] as const,
  forLead: (leadId: string) => ['deals', 'lead', leadId] as const,
  pipeline: (orgId: string | undefined) => ['deals', 'pipeline', orgId ?? 'single-org'] as const,
  calc: (inputs: CalculateDealInputT | null) => ['deal-calc', inputs] as const,
};

/**
 * Live preview: pure math on the server (nothing stored), re-queried whenever
 * the debounced worksheet inputs change. `placeholderData` keeps the previous
 * numbers on screen during the round-trip so the panel never flickers empty.
 */
export function useCalculateDeal(inputs: CalculateDealInputT | null) {
  return useQuery({
    queryKey: dealKeys.calc(inputs),
    enabled: inputs !== null,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.deals.calculate, { body: inputs, signal });
      if (res.status !== 200) fail(res.status, res.body);
      return DeskingOutputs.parse(res.body);
    },
  });
}

/** orgId comes from the loaded lead — the deals list 400s without it for multi-org users. */
export function useDealsForLead(leadId: string, orgId: string | undefined) {
  return useQuery({
    queryKey: dealKeys.forLead(leadId),
    enabled: orgId !== undefined,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.deals.list, {
        query: { lead_id: leadId, organization_id: orgId, limit: 100 },
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      return PaginatedDeals.parse(res.body);
    },
  });
}

const MAX_BOARD_PAGES = 3; // 300 rows — beyond that the board says it is truncated

/** Follows the cursor a bounded number of pages so the board isn't silently cut at 100. */
export function usePipelineDeals(orgId?: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: dealKeys.pipeline(orgId),
    enabled: opts?.enabled ?? true,
    queryFn: async ({ signal }) => {
      const items = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_BOARD_PAGES; page++) {
        const res = await apiRequest(routes.deals.list, {
          query: { organization_id: orgId, limit: 100, cursor },
          signal,
        });
        if (res.status !== 200) fail(res.status, res.body);
        const parsed = PaginatedDeals.parse(res.body);
        items.push(...parsed.items);
        if (!parsed.next_cursor) return { items, truncated: false };
        cursor = parsed.next_cursor;
      }
      return { items, truncated: true };
    },
  });
}

/** Stage/funding moves from the kanban — refreshes every deal view. */
export function useUpdateDealTracks(orgId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: UpdateDealInputT }) => {
      const res = await apiRequest(routes.deals.update, { params: { id }, body });
      if (res.status !== 200) fail(res.status, res.body);
      return Deal.parse(res.body);
    },
    onSuccess: (updated) => {
      // Write the server's answer straight into the board cache so the
      // controlled selects show the new value immediately (no snap-back),
      // then reconcile everything else in the background.
      queryClient.setQueryData(
        dealKeys.pipeline(orgId),
        (old: { items: DealT[]; truncated: boolean } | undefined) =>
          old ? { ...old, items: old.items.map((d) => (d.id === updated.id ? updated : d)) } : old,
      );
      void queryClient.invalidateQueries({ queryKey: dealKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['activity'] });
      // Funding writes commission lines in the same transaction server-side.
      if (updated.funding_status === 'funded') {
        void queryClient.invalidateQueries({ queryKey: ['commissions'] });
      }
    },
  });
}

export function useDeal(id: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['deals', 'one', id] as const,
    enabled: (opts?.enabled ?? true) && id !== '',
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.deals.get, { params: { id }, signal });
      if (res.status !== 200) fail(res.status, res.body);
      return Deal.parse(res.body);
    },
  });
}

/** CR-07: re-desking an existing deal — the server recomputes on input edits. */
export function useUpdateDealInputs() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: z.input<typeof UpdateDealInput> }) => {
      const res = await apiRequest(routes.deals.update, { params: { id }, body });
      if (res.status !== 200) fail(res.status, res.body);
      return Deal.parse(res.body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dealKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['activity'] });
    },
  });
}

export function useCreateDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateDealInputT) => {
      const res = await apiRequest(routes.deals.create, { body });
      if (res.status !== 201) fail(res.status, res.body);
      return Deal.parse(res.body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dealKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['activity'] });
    },
  });
}
