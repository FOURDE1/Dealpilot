import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  VehicleExpense,
  VehicleExpensesResult,
  type CreateExpenseInputT,
  type UpdateExpenseInputT,
} from '@dealpilot/schemas';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';

/**
 * F-82 — the vehicle expenses ledger hooks (the submissions-api.ts family:
 * one car's rows under one key, D-084).
 *
 * A record and a report input, never a desk input: nothing here touches the
 * vehicle's own cache or the desk. A logged, moved or receipted row moves the
 * ledger and the trail — the vehicle read stays exactly what f07 derives, so
 * the page never refetches the car on the ledger's account.
 *
 * `summary` is ABSENT (never {0, 0}) when the caller's cost view does not
 * cover the vehicle's store; every money field on a row masks with it.
 */
export const expenseKeys = {
  all: ['vehicle-expenses'] as const,
  forVehicle: (vehicleId: string) => ['vehicle-expenses', vehicleId] as const,
};

export function useVehicleExpenses(vehicleId: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: expenseKeys.forVehicle(vehicleId),
    enabled: (opts?.enabled ?? true) && vehicleId !== '',
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.vehicleExpenses.list, { params: { id: vehicleId }, signal });
      if (res.status !== 200) fail(res.status, res.body);
      return VehicleExpensesResult.parse(res.body);
    },
  });
}

/** A row logged, moved or receipted: the ledger and the trail move; the car does not. */
function invalidateAfterRowChange(queryClient: QueryClient, vehicleId: string) {
  void queryClient.invalidateQueries({ queryKey: expenseKeys.forVehicle(vehicleId) });
  void queryClient.invalidateQueries({ queryKey: ['activity'] });
}

export function useLogExpense(vehicleId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateExpenseInputT) => {
      const res = await apiRequest(routes.vehicleExpenses.create, { params: { id: vehicleId }, body });
      if (res.status !== 201) fail(res.status, res.body);
      return VehicleExpense.parse(res.body);
    },
    onSuccess: () => invalidateAfterRowChange(queryClient, vehicleId),
  });
}

/** One PATCH carries fields and/or a status — the ladder and the field edits share it. */
export function useUpdateExpense(vehicleId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: UpdateExpenseInputT }) => {
      const res = await apiRequest(routes.vehicleExpenses.update, { params: { id }, body });
      if (res.status !== 200) fail(res.status, res.body);
      return VehicleExpense.parse(res.body);
    },
    onSuccess: () => invalidateAfterRowChange(queryClient, vehicleId),
    // A refused move means the list on screen is behind the server — resync so
    // the buttons stop offering yesterday's transitions.
    onError: () => queryClient.invalidateQueries({ queryKey: expenseKeys.forVehicle(vehicleId) }),
  });
}

const UPLOAD_TIMEOUT_MS = 30_000;

/** The receipt's own path — the contract's route with the id substituted. */
export function receiptPath(expenseId: string): string {
  const rawPath = (routes.vehicleExpenses.uploadReceipt as unknown as { path: string }).path;
  return rawPath.replace(':id', encodeURIComponent(expenseId));
}

/**
 * Attach the invoice's scan. Raw bytes with a real content-type — the shared
 * apiRequest speaks JSON only, so this is the one call that goes to fetch
 * directly (documents/api.ts' idiom: same credentials, timeout and envelope
 * rules; anything but the route's 201 is a refusal).
 */
export function useUploadReceipt(vehicleId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      const res = await fetch(receiptPath(id), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': file.type },
        body: file,
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
      const body: unknown = await res.json().catch(() => undefined);
      if (res.status !== 201) fail(res.status, body);
      return VehicleExpense.parse(body);
    },
    onSuccess: () => invalidateAfterRowChange(queryClient, vehicleId),
  });
}

/**
 * The stored receipt back — the server rechecks the recorded hash and REFUSES
 * (409 content_mismatch) if the bytes changed; a masked caller gets a 404, like
 * the number. Returns an object URL for a new tab; the caller revokes it.
 */
export async function fetchReceipt(expenseId: string): Promise<string> {
  const res = await fetch(receiptPath(expenseId), {
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
