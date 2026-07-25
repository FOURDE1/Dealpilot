import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Deal,
  DeskingOutputs,
  paginated,
  type CalculateDealInputT,
  type CreateDealInputT,
} from '@dealpilot/schemas';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';

const PaginatedDeals = paginated(Deal);

export const dealKeys = {
  forLead: (leadId: string) => ['deals', 'lead', leadId] as const,
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

export function useCreateDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateDealInputT) => {
      const res = await apiRequest(routes.deals.create, { body });
      if (res.status !== 201) fail(res.status, res.body);
      return Deal.parse(res.body);
    },
    onSuccess: (deal) => {
      if (deal.lead_id) void queryClient.invalidateQueries({ queryKey: dealKeys.forLead(deal.lead_id) });
    },
  });
}
