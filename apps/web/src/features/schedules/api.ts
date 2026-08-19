import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { paginated, ScheduleTodayItem, StaffSchedule, type CreateStaffScheduleInputT } from '@dealpilot/schemas';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';

const Page = paginated(StaffSchedule);
const Today = z.object({ items: z.array(ScheduleTodayItem) });

export const scheduleKeys = {
  all: ['staff-schedules'] as const,
  list: (orgId: string | undefined) => ['staff-schedules', 'list', orgId ?? 'single-org'] as const,
  today: (orgId: string | undefined) => ['staff-schedules', 'today', orgId ?? 'single-org'] as const,
};

export function useSchedules(orgId?: string) {
  return useQuery({
    queryKey: scheduleKeys.list(orgId),
    enabled: orgId !== undefined,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.schedules.list, {
        query: { limit: 100, organization_id: orgId },
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      return Page.parse(res.body);
    },
  });
}

export function useScheduleToday(orgId?: string) {
  return useQuery({
    queryKey: scheduleKeys.today(orgId),
    enabled: orgId !== undefined,
    // Presence moves on its own clock (3-minute marks) — keep the board honest.
    refetchInterval: 60_000,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.schedules.today, {
        query: { organization_id: orgId },
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      return Today.parse(res.body);
    },
  });
}

export function useCreateSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateStaffScheduleInputT) => {
      const res = await apiRequest(routes.schedules.create, { body: input });
      if (res.status !== 201) fail(res.status, res.body);
      return StaffSchedule.parse(res.body);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: scheduleKeys.all }),
  });
}

export function useDeleteSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest(routes.schedules.remove, { params: { id } });
      if (res.status !== 204) fail(res.status, res.body);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: scheduleKeys.all }),
  });
}
