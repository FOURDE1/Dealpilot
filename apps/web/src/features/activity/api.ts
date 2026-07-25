import { useQuery } from '@tanstack/react-query';
import { ActivityEvent, paginated, type ActivityEntityTypeT } from '@dealpilot/schemas';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';

const PaginatedActivity = paginated(ActivityEvent);

export const activityKeys = {
  entity: (entityType: ActivityEntityTypeT, entityId: string) =>
    ['activity', entityType, entityId] as const,
};

async function fetchPages(
  query: Record<string, unknown>,
  signal: AbortSignal | undefined,
): Promise<{ items: import('@dealpilot/schemas').ActivityEventT[]; truncated: boolean }> {
  const items = [];
  let cursor: string | undefined;
  for (let page = 0; page < 3; page++) {
    const res = await apiRequest(routes.activity.list, {
      query: { ...query, limit: 100, cursor },
      signal,
    });
    if (res.status !== 200) fail(res.status, res.body);
    const parsed = PaginatedActivity.parse(res.body);
    items.push(...parsed.items);
    if (!parsed.next_cursor) return { items, truncated: false };
    cursor = parsed.next_cursor;
  }
  return { items, truncated: true };
}

/**
 * One entity's history, newest first. organization_id is REQUIRED knowledge —
 * the endpoint 400s for multi-org users without it. For deals, the deal's
 * checklist events live under entity_type 'checklist_item' keyed by ITEM id
 * (deal id only inside changes.deal_id) — until CR-04 gives a server-side
 * deal filter, we fetch the org's checklist events and keep this deal's.
 */
export function useActivity(
  entityType: ActivityEntityTypeT,
  entityId: string,
  orgId: string | undefined,
  opts?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: [...activityKeys.entity(entityType, entityId), orgId ?? 'single-org'],
    enabled: (opts?.enabled ?? true) && entityId !== '',
    queryFn: async ({ signal }) => {
      const base = await fetchPages(
        { entity_type: entityType, entity_id: entityId, organization_id: orgId },
        signal,
      );
      if (entityType !== 'deal') return base;
      const checklist = await fetchPages(
        { entity_type: 'checklist_item', organization_id: orgId },
        signal,
      );
      const mine = checklist.items.filter(
        (e) => (e.changes as { deal_id?: unknown }).deal_id === entityId,
      );
      const items = [...base.items, ...mine].sort((a, b) =>
        b.created_at.localeCompare(a.created_at),
      );
      return { items, truncated: base.truncated || checklist.truncated };
    },
  });
}
