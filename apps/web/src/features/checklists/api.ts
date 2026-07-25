import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  ChecklistReadiness,
  ChecklistTemplate,
  DealChecklistItem,
  UpdateChecklistItemInput,
  UpdateChecklistTemplateInput,
} from '@dealpilot/schemas';
import { apiRequest, failFromResponse as fail } from '../../shared/api/client.js';

/**
 * F-08 endpoints are not yet in the shared apiV1 contract (CR-03) — these
 * literals mirror docs/HUSSEIN-F08-CONTRACT.md and parse with the shared
 * schemas, so the wire shapes stay contract-checked.
 */
const ROUTES = {
  dealChecklist: { method: 'GET', path: '/api/v1/deals/:id/checklist' },
  updateItem: { method: 'PATCH', path: '/api/v1/deals/:id/checklist/:code' },
  storeTemplate: { method: 'GET', path: '/api/v1/stores/:id/checklist-template' },
  updateTemplate: { method: 'PATCH', path: '/api/v1/stores/:id/checklist-template/:code' },
} as const;

const DealChecklist = z.object({
  items: z.array(DealChecklistItem),
  readiness: ChecklistReadiness,
});
const TemplateList = z.object({ items: z.array(ChecklistTemplate) });

export const checklistKeys = {
  deal: (dealId: string) => ['checklist', 'deal', dealId] as const,
  template: (storeId: string) => ['checklist', 'template', storeId] as const,
};

export function useDealChecklist(dealId: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: checklistKeys.deal(dealId),
    enabled: (opts?.enabled ?? true) && dealId !== '',
    queryFn: async ({ signal }) => {
      const res = await apiRequest(ROUTES.dealChecklist, { params: { id: dealId }, signal });
      if (res.status !== 200) fail(res.status, res.body);
      return DealChecklist.parse(res.body);
    },
  });
}

export function useUpdateChecklistItem(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ code, body }: { code: string; body: z.infer<typeof UpdateChecklistItemInput> }) => {
      const res = await apiRequest(ROUTES.updateItem, { params: { id: dealId, code }, body });
      if (res.status !== 200) fail(res.status, res.body);
      return DealChecklistItem.parse(res.body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: checklistKeys.deal(dealId) });
      // Readiness gates the pipeline's Delivered/Complete moves.
      void queryClient.invalidateQueries({ queryKey: ['deals'] });
    },
  });
}

export function useStoreTemplate(storeId: string) {
  return useQuery({
    queryKey: checklistKeys.template(storeId),
    enabled: storeId !== '',
    queryFn: async ({ signal }) => {
      const res = await apiRequest(ROUTES.storeTemplate, { params: { id: storeId }, signal });
      if (res.status !== 200) fail(res.status, res.body);
      return TemplateList.parse(res.body);
    },
  });
}

export function useUpdateTemplateItem(storeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ code, body }: { code: string; body: z.infer<typeof UpdateChecklistTemplateInput> }) => {
      const res = await apiRequest(ROUTES.updateTemplate, { params: { id: storeId, code }, body });
      if (res.status !== 200) fail(res.status, res.body);
      return ChecklistTemplate.parse(res.body);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: checklistKeys.template(storeId) }),
  });
}
