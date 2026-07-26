import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { DealDocumentsResponse, DealDocument, UpdateDocumentInput } from '@dealpilot/schemas';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';

export const documentKeys = {
  deal: (dealId: string) => ['documents', 'deal', dealId] as const,
};

/**
 * F-13: the deal's paper file. The server derives WHICH documents from the
 * deal's own shape and generates missing rows on read, so this is never empty
 * for a real deal — `wet_ink_prepared` is the answer dispatch gates on.
 */
export function useDealDocuments(dealId: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: documentKeys.deal(dealId),
    enabled: (opts?.enabled ?? true) && dealId !== '',
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.documents.forDeal, { params: { id: dealId }, signal });
      if (res.status !== 200) fail(res.status, res.body);
      return DealDocumentsResponse.parse(res.body);
    },
  });
}

export function useUpdateDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: z.input<typeof UpdateDocumentInput> }) => {
      const res = await apiRequest(routes.documents.update, { params: { id }, body });
      if (res.status !== 200) fail(res.status, res.body);
      return DealDocument.parse(res.body);
    },
    // Prefix invalidation on purpose: the render-time dealId can be '' if the
    // dialog closed mid-flight, and there is at most one documents query open.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
      void queryClient.invalidateQueries({ queryKey: ['activity'] });
    },
    // A refused move means the list on screen is behind the server — resync so
    // the action buttons stop offering yesterday's transitions.
    onError: () => queryClient.invalidateQueries({ queryKey: ['documents'] }),
  });
}
