import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { DistributionRow, type PutDistributionConfigInputT } from '@dealpilot/schemas';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';

const RowWithDeviation = DistributionRow.extend({ deviation: z.string() });
const Rows = z.object({ items: z.array(RowWithDeviation) });
export type DistributionRowWithDeviationT = z.infer<typeof RowWithDeviation>;

export const distributionKeys = {
  all: ['distribution'] as const,
  list: (orgId: string | undefined, platform: string) =>
    ['distribution', 'list', orgId ?? 'single-org', platform] as const,
  history: (orgId: string | undefined, platform: string) =>
    ['distribution', 'history', orgId ?? 'single-org', platform] as const,
};

export function useDistribution(orgId: string | undefined, platform: 'google' | 'meta') {
  return useQuery({
    queryKey: distributionKeys.list(orgId, platform),
    enabled: orgId !== undefined,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.distribution.read, {
        query: { organization_id: orgId!, platform },
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      return Rows.parse(res.body);
    },
  });
}

export function useDistributionHistory(orgId: string | undefined, platform: 'google' | 'meta') {
  return useQuery({
    queryKey: distributionKeys.history(orgId, platform),
    enabled: orgId !== undefined,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.distribution.history, {
        query: { organization_id: orgId!, platform },
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      return Rows.parse(res.body);
    },
  });
}

export function usePutDistributionConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: PutDistributionConfigInputT) => {
      const res = await apiRequest(routes.distribution.putConfig, { body: input });
      if (res.status !== 200) fail(res.status, res.body);
      return z.object({ items: z.array(DistributionRow) }).parse(res.body);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: distributionKeys.all }),
  });
}
