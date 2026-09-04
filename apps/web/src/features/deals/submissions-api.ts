import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  DealSubmission,
  SelectSubmissionResult,
  type CreateSubmissionInputT,
  type DealT,
  type SelectSubmissionResultT,
  type UpdateSubmissionInputT,
} from '@dealpilot/schemas';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';
import { dealKeys } from './api.js';

/**
 * F-81 — the lender submissions ledger hooks (the fi-products-api.ts family,
 * one deal's rows under one key).
 *
 * « Choisir cette approbation » is the only write that moves the DEAL: the
 * server promotes the row's lender / sell rate / term and recomputes, and
 * answers `{ submission, deal }`. The deal is written straight into the
 * `useDeal` cache (the useUpdateDealTracks no-snap-back precedent) so a
 * reopen agrees with the screen, and the list is invalidated for the sibling
 * flip (one bounded GET). Every other reader of deals reconciles on
 * `dealKeys.all`.
 */
const SubmissionList = z.array(DealSubmission);

export const submissionKeys = {
  all: ['submissions'] as const,
  forDeal: (dealId: string) => ['submissions', dealId] as const,
};

export function useSubmissions(dealId: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: submissionKeys.forDeal(dealId),
    enabled: (opts?.enabled ?? true) && dealId !== '',
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.dealSubmissions.list, { params: { id: dealId }, signal });
      if (res.status !== 200) fail(res.status, res.body);
      return SubmissionList.parse(res.body);
    },
  });
}

/** A row logged or corrected: the list and the trail move; the deal does not. */
function invalidateAfterRowChange(queryClient: QueryClient, dealId: string) {
  void queryClient.invalidateQueries({ queryKey: submissionKeys.forDeal(dealId) });
  void queryClient.invalidateQueries({ queryKey: ['activity'] });
}

export function useCreateSubmission(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateSubmissionInputT) => {
      const res = await apiRequest(routes.dealSubmissions.create, { params: { id: dealId }, body });
      if (res.status !== 201) fail(res.status, res.body);
      return DealSubmission.parse(res.body);
    },
    onSuccess: () => invalidateAfterRowChange(queryClient, dealId),
  });
}

export function useUpdateSubmission(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: UpdateSubmissionInputT }) => {
      const res = await apiRequest(routes.dealSubmissions.update, { params: { id }, body });
      if (res.status !== 200) fail(res.status, res.body);
      return DealSubmission.parse(res.body);
    },
    onSuccess: () => invalidateAfterRowChange(queryClient, dealId),
  });
}

/**
 * What a successful select does to the caches, as a plain function so the
 * claim is unit-testable without a renderer: the deal lands in the `useDeal`
 * cache BEFORE anything refetches (no snap-back), the page is told so it can
 * rewrite its draft (the stale-form fix), then the list, every deal view and
 * the trail reconcile in the background.
 */
export function applySelectResult(
  queryClient: QueryClient,
  dealId: string,
  result: SelectSubmissionResultT,
  onPromoted?: (deal: DealT) => void,
): void {
  queryClient.setQueryData(['deals', 'one', dealId], result.deal);
  onPromoted?.(result.deal);
  void queryClient.invalidateQueries({ queryKey: submissionKeys.forDeal(dealId) });
  void queryClient.invalidateQueries({ queryKey: dealKeys.all });
  void queryClient.invalidateQueries({ queryKey: ['activity'] });
}

export function useSelectSubmission(dealId: string, opts?: { onPromoted?: (deal: DealT) => void }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (submissionId: string) => {
      // No body: the contract's select carries none (z.undefined()).
      const res = await apiRequest(routes.dealSubmissions.select, { params: { id: submissionId } });
      if (res.status !== 200) fail(res.status, res.body);
      return SelectSubmissionResult.parse(res.body);
    },
    onSuccess: (result) => applySelectResult(queryClient, dealId, result, opts?.onPromoted),
  });
}
