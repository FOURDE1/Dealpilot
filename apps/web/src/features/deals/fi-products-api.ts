import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { DealFiProduct, type CreateFiProductInput } from '@dealpilot/schemas';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';

export const fiProductKeys = {
  deal: (dealId: string) => ['fi-products', dealId] as const,
};

const FiProductList = z.array(DealFiProduct);

/**
 * F-13b: the itemised products behind the deal's aggregate F&I numbers. The
 * per-product agreements in the document file are named after these rows, and
 * the deal's fi_price/fi_cost are their trigger-maintained sum.
 */
export function useFiProducts(dealId: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: fiProductKeys.deal(dealId),
    enabled: (opts?.enabled ?? true) && dealId !== '',
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.fiProducts.forDeal, { params: { id: dealId }, signal });
      if (res.status !== 200) fail(res.status, res.body);
      return FiProductList.parse(res.body);
    },
  });
}

/** A product mutation moves deal money and re-derives the file — refresh both. */
function invalidateAfterProductChange(queryClient: ReturnType<typeof useQueryClient>, dealId: string) {
  void queryClient.invalidateQueries({ queryKey: fiProductKeys.deal(dealId) });
  void queryClient.invalidateQueries({ queryKey: ['deals'] });
  void queryClient.invalidateQueries({ queryKey: ['documents'] });
  void queryClient.invalidateQueries({ queryKey: ['activity'] });
}

export function useCreateFiProduct(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateFiProductInput) => {
      const res = await apiRequest(routes.fiProducts.create, { params: { id: dealId }, body });
      if (res.status !== 201) fail(res.status, res.body);
      return DealFiProduct.parse(res.body);
    },
    onSuccess: () => invalidateAfterProductChange(queryClient, dealId),
  });
}

export function useDeleteFiProduct(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (productId: string) => {
      const res = await apiRequest(routes.fiProducts.remove, { params: { id: productId } });
      if (res.status !== 204) fail(res.status, res.body);
    },
    onSuccess: () => invalidateAfterProductChange(queryClient, dealId),
  });
}
