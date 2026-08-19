import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NotificationList } from '@dealpilot/schemas';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';

export const notificationKeys = {
  all: ['notifications'] as const,
};

export function useNotifications() {
  return useQuery({
    queryKey: notificationKeys.all,
    // The realtime hint invalidates this the moment a row lands; the interval
    // is the fallback for rows written by the WORKERS, which have no emitter
    // (D-050) — one minute is the agreed staleness for those.
    refetchInterval: 60_000,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.notifications.list, { signal });
      if (res.status !== 200) fail(res.status, res.body);
      return NotificationList.parse(res.body);
    },
  });
}

export function useMarkRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest(routes.notifications.read, { params: { id } });
      if (res.status !== 204) fail(res.status, res.body);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

export function useMarkAllRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest(routes.notifications.readAll, {});
      if (res.status !== 204) fail(res.status, res.body);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}
