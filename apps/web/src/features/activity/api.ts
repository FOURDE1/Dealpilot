import { useQuery } from '@tanstack/react-query';
import { ActivityEvent, paginated, type ActivityEntityTypeT } from '@dealpilot/schemas';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';

const PaginatedActivity = paginated(ActivityEvent);

export const activityKeys = {
  entity: (entityType: ActivityEntityTypeT, entityId: string) =>
    ['activity', entityType, entityId] as const,
};

/** One entity's history, newest first (the server orders by seq DESC). */
export function useActivity(
  entityType: ActivityEntityTypeT,
  entityId: string,
  opts?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: activityKeys.entity(entityType, entityId),
    enabled: (opts?.enabled ?? true) && entityId !== '',
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.activity.list, {
        query: { entity_type: entityType, entity_id: entityId, limit: 100 },
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      return PaginatedActivity.parse(res.body);
    },
  });
}
