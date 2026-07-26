import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  BatchDocumentInput,
  DealDocumentsResponse,
  DealDocument,
  UpdateDocumentInput,
} from '@dealpilot/schemas';
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

/**
 * F-13c: mark a whole stack printed (or filed) in one transaction — a clerk
 * files a deal as a stack, and thirteen clicks is how a status field stops
 * matching reality. All-or-nothing server-side.
 */
export function useBatchDocuments(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: z.infer<typeof BatchDocumentInput>) => {
      const res = await apiRequest(routes.documents.batch, { params: { id: dealId }, body });
      if (res.status !== 200) fail(res.status, res.body);
      return z.object({ items: z.array(DealDocument) }).parse(res.body).items;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
      void queryClient.invalidateQueries({ queryKey: ['activity'] });
    },
    onError: () => queryClient.invalidateQueries({ queryKey: ['documents'] }),
  });
}

const UPLOAD_TIMEOUT_MS = 30_000;

function documentFilePath(documentId: string): string {
  const rawPath = (routes.documents.uploadFile as unknown as { path: string }).path;
  return rawPath.replace(':id', encodeURIComponent(documentId));
}

/**
 * F-13c: attach the scanned page. Raw bytes with a real content-type — the
 * shared apiRequest speaks JSON only, so this is the one call that goes to
 * fetch directly (same credentials, timeout and error-envelope rules).
 */
export function useUploadDocumentFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      const res = await fetch(documentFilePath(id), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': file.type },
        body: file,
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
      const body: unknown = await res.json().catch(() => undefined);
      if (res.status !== 201) fail(res.status, body);
      return DealDocument.parse(body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
      void queryClient.invalidateQueries({ queryKey: ['activity'] });
    },
  });
}

/**
 * The stored page back — the server rechecks the recorded hash and REFUSES
 * (409 content_mismatch) if the bytes changed. Returns an object URL for a
 * new tab; the caller revokes it.
 */
export async function fetchDocumentFile(documentId: string): Promise<string> {
  const res = await fetch(documentFilePath(documentId), {
    method: 'GET',
    credentials: 'include',
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  if (res.status !== 200) {
    const body: unknown = await res.json().catch(() => undefined);
    fail(res.status, body);
  }
  return URL.createObjectURL(await res.blob());
}
