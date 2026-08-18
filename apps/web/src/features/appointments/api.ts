import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Appointment,
  type CancelAppointmentInputT,
  type CreateAppointmentInputT,
  type UpdateAppointmentInputT,
} from '@dealpilot/schemas';
import { z } from 'zod';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';

const Board = z.object({ items: z.array(Appointment), truncated: z.boolean() });

export const appointmentKeys = {
  all: ['appointments'] as const,
  board: (orgId: string | undefined, upcoming: boolean) =>
    ['appointments', 'board', orgId ?? 'single-org', upcoming] as const,
};

export function useAppointments(orgId?: string, opts?: { enabled?: boolean; upcoming?: boolean }) {
  const upcoming = opts?.upcoming ?? true;
  return useQuery({
    queryKey: appointmentKeys.board(orgId, upcoming),
    enabled: opts?.enabled ?? true,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.appointments.list, {
        // The wire speaks 'true'/'false' strings on purpose — see the schema's
        // note on the z.coerce.boolean trap.
        query: { organization_id: orgId, upcoming: upcoming ? 'true' : 'false' },
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      return Board.parse(res.body);
    },
  });
}

export function useCreateAppointment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateAppointmentInputT) => {
      const res = await apiRequest(routes.appointments.create, { body: input });
      if (res.status !== 201) fail(res.status, res.body);
      return Appointment.parse(res.body);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: appointmentKeys.all }),
  });
}

export function useUpdateAppointment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: UpdateAppointmentInputT & { id: string }) => {
      const res = await apiRequest(routes.appointments.update, { params: { id }, body: input });
      if (res.status !== 200) fail(res.status, res.body);
      return Appointment.parse(res.body);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: appointmentKeys.all }),
  });
}

export function useCancelAppointment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: CancelAppointmentInputT & { id: string }) => {
      const res = await apiRequest(routes.appointments.cancel, { params: { id }, body: input });
      if (res.status !== 200) fail(res.status, res.body);
      return Appointment.parse(res.body);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: appointmentKeys.all }),
  });
}
