import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActiveAnnouncements } from '@dealpilot/schemas';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';

/**
 * F-72 — what a tenant user is told (admin-console.md §8; D-073).
 *
 * ONE query behind two mounts: the interrupting banner and the quiet notices
 * both call this hook and react-query dedupes them to a single fetch, so the
 * shell never asks twice for the same list.
 *
 * The route takes no recipient and no organization — the server reads the
 * person from the session — so there is nothing to key the cache on beyond
 * the query itself, and signing out clears it with the rest of the cache.
 */

export const announcementKeys = {
  all: ['announcements'] as const,
};

export function useActiveAnnouncements() {
  return useQuery({
    queryKey: announcementKeys.all,
    // A platform incident is published while people already have the app
    // open; the shell has no realtime hint for it (an announcement belongs to
    // no tenant, so there is no room to emit into), which makes the poll the
    // whole delivery. One minute is the bell's agreed staleness.
    refetchInterval: 60_000,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.announcements.active, { signal });
      if (res.status !== 200) fail(res.status, res.body);
      return ActiveAnnouncements.parse(res.body);
    },
  });
}

/**
 * Dismissal is permanent and per person — the server refuses it outright for
 * a maintenance or incident notice, and refuses it during a support session
 * so a staffer can never silence a dealer's banner in the dealer's name.
 */
export function useDismissAnnouncement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest(routes.announcements.dismiss, { params: { id } });
      if (res.status !== 204) fail(res.status, res.body);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: announcementKeys.all }),
  });
}
