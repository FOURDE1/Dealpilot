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
 * One entity's history, newest first — including what happened UNDER it
 * (CR-04 parent roll-up). organization_id is required knowledge: the endpoint
 * 400s for multi-org users without it.
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
      // CR-04: the server rolls up child events (checklist acts, dispatch,
      // documents) under entity_id — entity_type must stay OFF the wire or it
      // would filter the children (their type differs) back out.
      return fetchPages({ entity_id: entityId, organization_id: orgId }, signal);
    },
  });
}
