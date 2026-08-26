import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Task,
  TaskListPage,
  TaskSummary,
  BulkTasksResult,
  type BulkCompleteTasksInputT,
  type BulkReassignTasksInputT,
  type CreateTaskInputT,
  type TaskBucketT,
  type TaskSubjectTypeT,
  type UpdateTaskInputT,
} from '@dealpilot/schemas';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';

/** F-68 — the task system's client side (appointments-tasks-communications.md §3.3). */

export interface TaskFilters {
  subjectType?: TaskSubjectTypeT;
  subjectId?: string;
  assignedTo?: string;
  storeId?: string;
  /** Default true — the board is for what still needs doing. */
  open?: boolean;
  bucket?: TaskBucketT;
}

export const taskKeys = {
  all: ['tasks'] as const,
  list: (orgId: string | undefined, f: TaskFilters) => ['tasks', 'list', orgId ?? 'single-org', f] as const,
  summary: (orgId: string | undefined, assignedTo: string | undefined, storeId: string | undefined) =>
    ['tasks', 'summary', orgId ?? 'single-org', assignedTo ?? 'all', storeId ?? 'all'] as const,
};

/**
 * A task mutation changes two things on the lead page: the panel AND the
 * History below it (the trail records created / task_completed / assigned).
 * Both refetch (review).
 */
function invalidateTaskViews(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: taskKeys.all });
  void queryClient.invalidateQueries({ queryKey: ['activity'] });
}

/** Query strings carry no `undefined`: drop the keys the caller left blank. */
function compact<T extends Record<string, string | undefined>>(q: T): Record<string, string> {
  return Object.fromEntries(Object.entries(q).filter((kv): kv is [string, string] => kv[1] !== undefined));
}

export function useTasks(orgId: string | undefined, filters: TaskFilters, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: taskKeys.list(orgId, filters),
    enabled: opts?.enabled ?? true,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.tasks.list, {
        query: compact({
          organization_id: orgId,
          subject_type: filters.subjectType,
          subject_id: filters.subjectId,
          assigned_to: filters.assignedTo,
          store_id: filters.storeId,
          bucket: filters.bucket,
          // Strings on the wire — see the schema's note on the coerce trap.
          open: filters.open === false ? 'false' : 'true',
        }),
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      return TaskListPage.parse(res.body);
    },
  });
}

export function useTaskSummary(
  orgId: string | undefined,
  opts?: { assignedTo?: string; storeId?: string; enabled?: boolean },
) {
  return useQuery({
    queryKey: taskKeys.summary(orgId, opts?.assignedTo, opts?.storeId),
    enabled: opts?.enabled ?? true,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.tasks.summary, {
        query: compact({ organization_id: orgId, assigned_to: opts?.assignedTo, store_id: opts?.storeId }),
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      return TaskSummary.parse(res.body);
    },
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateTaskInputT) => {
      const res = await apiRequest(routes.tasks.create, { body: input });
      if (res.status !== 201) fail(res.status, res.body);
      return Task.parse(res.body);
    },
    onSuccess: () => void invalidateTaskViews(queryClient),
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: UpdateTaskInputT & { id: string }) => {
      const res = await apiRequest(routes.tasks.update, { params: { id }, body: input });
      if (res.status !== 200) fail(res.status, res.body);
      return Task.parse(res.body);
    },
    onSuccess: () => void invalidateTaskViews(queryClient),
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest(routes.tasks.remove, { params: { id } });
      if (res.status !== 204) fail(res.status, res.body);
    },
    onSuccess: () => void invalidateTaskViews(queryClient),
  });
}

export function useBulkCompleteTasks() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: BulkCompleteTasksInputT) => {
      const res = await apiRequest(routes.tasks.bulkComplete, { body: input });
      if (res.status !== 200) fail(res.status, res.body);
      return BulkTasksResult.parse(res.body);
    },
    onSuccess: () => void invalidateTaskViews(queryClient),
  });
}

export function useBulkReassignTasks() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: BulkReassignTasksInputT) => {
      const res = await apiRequest(routes.tasks.bulkReassign, { body: input });
      if (res.status !== 200) fail(res.status, res.body);
      return BulkTasksResult.parse(res.body);
    },
    onSuccess: () => void invalidateTaskViews(queryClient),
  });
}
