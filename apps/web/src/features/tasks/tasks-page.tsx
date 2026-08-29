import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, Label, Select, type ColumnDef } from '@dealpilot/ui';
import { BULK_TASK_LIMIT, type TaskBucketT, type TaskPriorityT, type TaskT } from '@dealpilot/schemas';
import { usePageTitle } from '../../shared/use-page-title.js';
import { useMe } from '../../shared/api/use-me.js';
import { useOrganizations } from '../organizations/api.js';
import { activeMembers, useMembers } from '../team/api.js';
import { useBulkCompleteTasks, useBulkReassignTasks, useTasks, useUpdateTask } from './api.js';
import { FollowUpAlertBar } from './follow-up-alert-bar.js';
import {
  BUCKET_CLASSES, BUCKET_KEYS, PRIORITY_CLASSES, PRIORITY_KEYS, STATUS_KEYS, SUBJECT_KEYS, TYPE_KEYS, subjectHref,
} from './labels.js';

/**
 * F-68 — the task board (appointments-tasks-communications.md §3).
 *
 * Mine by default, open by default, overdue first: the question every
 * morning is "what do I owe", not "what exists". Bulk complete / reassign
 * on a selection (§3.2): the server takes 50 at a time, so a bigger
 * selection is sent in 50-id chunks and the count adds up (review).
 *
 * A notification's deep link arrives as `?task=<id>`: the board then opens
 * on EVERYBODY's tasks, because the alert went to a manager about somebody
 * else's task (review).
 */

const BUCKETS = ['overdue', 'today', 'week', 'later', 'undated'] as const satisfies readonly TaskBucketT[];
const CLOSED = new Set<TaskT['status']>(['completed', 'cancelled']);
/** Column sorts that mean something: urgent first, undated last (review). */
const PRIORITY_RANK: Record<TaskPriorityT, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
const dueTime = (t: TaskT) => (t.due_at ? new Date(t.due_at).getTime() : Number.POSITIVE_INFINITY);

function isBucket(v: string | null): v is TaskBucketT {
  return v !== null && (BUCKETS as readonly string[]).includes(v);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function TasksPage() {
  const { t, i18n } = useTranslation('tasks');
  usePageTitle(t('title'));
  const [params, setParams] = useSearchParams();
  const orgs = useOrganizations();
  // better-auth's data is null while pending, never undefined (review).
  // F-71: who I am comes from the server (a support session acts as the member).
  const me = useMe();
  const multiOrg = (orgs.data?.items.length ?? 0) > 1;
  // The alert bar's links carry the organization their counts were made for.
  const [orgFilter, setOrgFilter] = useState(params.get('org') ?? '');
  const orgId = multiOrg ? orgFilter || orgs.data?.items[0]?.id : orgs.data?.items[0]?.id;
  const focusTask = params.get('task');
  const [mineOnly, setMineOnly] = useState(focusTask === null);
  const [showCompleted, setShowCompleted] = useState(false);
  const bucket = isBucket(params.get('bucket')) ? (params.get('bucket') as TaskBucketT) : undefined;
  const assignedTo = mineOnly ? me.data?.user.id : undefined;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reassignTo, setReassignTo] = useState('');
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [rowMessage, setRowMessage] = useState<{ kind: 'status' | 'alert'; text: string } | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);

  // "Mine" needs to know who I am: until the session resolves, ask for nothing
  // rather than briefly showing everybody's board (review).
  const ready = orgId !== undefined && (!mineOnly || me.isSuccess);
  const tasks = useTasks(orgId, { assignedTo, open: !showCompleted, bucket }, { enabled: ready });
  const members = useMembers(orgId, { enabled: orgId !== undefined });
  const update = useUpdateTask();
  const bulkComplete = useBulkCompleteTasks();
  const bulkReassign = useBulkReassignTasks();
  const nameOf = useMemo(
    () => new Map(activeMembers(members.data?.items).map((m) => [m.user_id, m.name])),
    [members.data],
  );
  const fmt = (iso: string) => new Date(iso).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });

  const rows = useMemo(() => tasks.data?.items ?? [], [tasks.data]);

  // A selection belongs to the list it was made on: a new cut clears it,
  // and rows that left the board leave the selection (review).
  useEffect(() => {
    setSelected(new Set());
  }, [orgId, assignedTo, showCompleted, bucket]);
  useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(rows.map((r) => r.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someSelected = rows.some((r) => selected.has(r.id));
  // The linked task is not on this cut — closed, or outside the store scope.
  const focusMissing = focusTask !== null && tasks.isSuccess && !rows.some((r) => r.id === focusTask);
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const announce = (kind: 'status' | 'alert', text: string) => {
    setRowMessage({ kind, text });
    // The activated control disables and may leave the list: park focus on
    // the message so a keyboard user is not dropped at the top of the page.
    requestAnimationFrame(() => statusRef.current?.focus());
  };

  const flip = async (task: TaskT) => {
    const reopen = CLOSED.has(task.status);
    try {
      await update.mutateAsync({ id: task.id, status: reopen ? 'pending' : 'completed' });
      announce('status', t(reopen ? 'statusReopened' : 'statusCompleted', { title: task.title }));
    } catch {
      announce('alert', t('rowError', { title: task.title }));
    }
  };

  const runBulk = async (kind: 'complete' | 'reassign') => {
    if (!orgId || selected.size === 0) return;
    setBulkMessage(null);
    let updated = 0;
    try {
      for (const task_ids of chunk([...selected], BULK_TASK_LIMIT)) {
        const result =
          kind === 'complete'
            ? await bulkComplete.mutateAsync({ organization_id: orgId, task_ids })
            : await bulkReassign.mutateAsync({ organization_id: orgId, task_ids, assigned_to: reassignTo });
        updated += result.updated;
      }
      setBulkMessage(t('bulkDone', { count: updated }));
      setSelected(new Set());
    } catch {
      setBulkMessage(t('bulkError', { count: updated }));
    }
  };

  const columns = useMemo<ColumnDef<TaskT, unknown>[]>(
    () => [
      {
        id: 'select',
        header: () => (
          <input
            type="checkbox"
            className="size-4"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = someSelected && !allSelected;
            }}
            onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
            aria-label={t('selectAll')}
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            className="size-4"
            checked={selected.has(row.original.id)}
            onChange={() => toggleOne(row.original.id)}
            aria-label={t('select', { title: row.original.title })}
          />
        ),
        enableSorting: false,
      },
      {
        accessorKey: 'title',
        header: t('col_title'),
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span className={row.original.id === focusTask ? 'font-semibold underline underline-offset-4' : 'font-medium'}>
              {row.original.title}
            </span>
            <span className="text-xs text-muted-foreground">{t(TYPE_KEYS[row.original.task_type])}</span>
          </span>
        ),
      },
      {
        id: 'subject',
        header: t('col_subject'),
        cell: ({ row }) => {
          const href = subjectHref(row.original.subject_type, row.original.subject_id);
          const kind = t(SUBJECT_KEYS[row.original.subject_type]);
          const name = row.original.subject_label;
          return (
            <span className="flex flex-col">
              {href ? (
                <Link to={href} className="underline underline-offset-4">{name ?? kind}</Link>
              ) : (
                <span>{name ?? kind}</span>
              )}
              {name ? <span className="text-xs text-muted-foreground">{kind}</span> : null}
            </span>
          );
        },
        enableSorting: false,
      },
      {
        accessorKey: 'due_at',
        header: t('col_due'),
        sortingFn: (a, b) => dueTime(a.original) - dueTime(b.original),
        cell: ({ row }) => {
          const task = row.original;
          return (
            <span className="flex flex-col gap-0.5">
              <span className={task.bucket === 'overdue' ? 'font-semibold text-danger-text' : ''}>
                {task.due_at
                  ? task.bucket === 'overdue'
                    ? `${t('overduePrefix')} ${fmt(task.due_at)}`
                    : fmt(task.due_at)
                  : t('noDue')}
              </span>
              {task.bucket ? (
                <span className={`w-fit rounded-full px-2 py-0.5 text-xs ${BUCKET_CLASSES[task.bucket]}`}>
                  {t(BUCKET_KEYS[task.bucket])}
                </span>
              ) : null}
            </span>
          );
        },
      },
      {
        accessorKey: 'priority',
        header: t('col_priority'),
        sortingFn: (a, b) => PRIORITY_RANK[a.original.priority] - PRIORITY_RANK[b.original.priority],
        cell: ({ row }) => (
          <span className={`rounded-full px-2 py-0.5 text-xs ${PRIORITY_CLASSES[row.original.priority]}`}>
            {t(PRIORITY_KEYS[row.original.priority])}
          </span>
        ),
      },
      {
        id: 'assignee',
        header: t('col_assignee'),
        cell: ({ row }) =>
          row.original.assigned_to ? (nameOf.get(row.original.assigned_to) ?? '—') : t('unassigned'),
        enableSorting: false,
      },
      {
        accessorKey: 'status',
        header: t('col_status'),
        cell: ({ row }) => {
          const task = row.original;
          const reopen = CLOSED.has(task.status);
          return (
            <span className="flex flex-wrap items-center gap-2">
              <span>{t(STATUS_KEYS[task.status])}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={update.isPending}
                aria-label={t(reopen ? 'reopenLabel' : 'completeLabel', { title: task.title })}
                onClick={() => void flip(task)}
              >
                {t(reopen ? 'reopen' : 'complete')}
              </Button>
            </span>
          );
        },
        enableSorting: false,
      },
    ],
    // t/fmt are stable per language; the rows and the selection drive the checkboxes.
    [t, i18n.language, rows, selected, allSelected, someSelected, nameOf, update.isPending, focusTask],
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 gap-y-2">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <span className="flex flex-wrap items-center gap-4">
          <label htmlFor="my-tasks" className="flex items-center gap-2 text-sm max-lg:min-h-11">
            <input id="my-tasks" type="checkbox" className="size-4" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
            {t('mine')}
          </label>
          <label htmlFor="done-tasks" className="flex items-center gap-2 text-sm max-lg:min-h-11">
            <input id="done-tasks" type="checkbox" className="size-4" checked={showCompleted} onChange={(e) => setShowCompleted(e.target.checked)} />
            {t('showCompleted')}
          </label>
        </span>
      </header>
      <p className="max-w-2xl text-sm text-muted-foreground">{t('subtitle')}</p>
      {focusTask ? (
        <p role="status" className="text-sm text-muted-foreground">
          {focusMissing ? t('taskNotVisible') : t('fromNotification')}
        </p>
      ) : null}

      <FollowUpAlertBar orgId={orgId} assignedTo={assignedTo} enabled={ready} />

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="task-bucket">{t('bucket')}</Label>
          <Select
            id="task-bucket"
            value={bucket ?? ''}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              if (e.target.value) next.set('bucket', e.target.value);
              else next.delete('bucket');
              setParams(next, { replace: true });
            }}
          >
            <option value="">{t('bucket_all')}</option>
            {BUCKETS.map((b) => (
              <option key={b} value={b}>{t(BUCKET_KEYS[b])}</option>
            ))}
          </Select>
        </div>
        {multiOrg ? (
          <div className="max-w-xs space-y-1">
            <Label htmlFor="task-org">{t('organization')}</Label>
            <Select id="task-org" value={orgId ?? ''} onChange={(e) => setOrgFilter(e.target.value)}>
              {orgs.data?.items.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>

      {selected.size > 0 ? (
        <div role="region" aria-label={t('selected', { count: selected.size })} className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3 text-sm">
          <span className="font-medium">{t('selected', { count: selected.size })}</span>
          <Button type="button" size="sm" disabled={bulkComplete.isPending} onClick={() => void runBulk('complete')}>
            {t('bulkComplete')}
          </Button>
          <div className="space-y-1">
            <Label htmlFor="task-reassign">{t('reassignTo')}</Label>
            <Select id="task-reassign" value={reassignTo} onChange={(e) => setReassignTo(e.target.value)}>
              <option value="">{t('reassignPlaceholder')}</option>
              {activeMembers(members.data?.items).map((m) => (
                <option key={m.user_id} value={m.user_id}>{m.name}</option>
              ))}
            </Select>
          </div>
          <Button type="button" size="sm" variant="outline" disabled={!reassignTo || bulkReassign.isPending} onClick={() => void runBulk('reassign')}>
            {t('reassign')}
          </Button>
        </div>
      ) : null}
      {bulkMessage ? <p role="status" className="text-sm text-muted-foreground">{bulkMessage}</p> : null}
      <p
        ref={statusRef}
        tabIndex={-1}
        role={rowMessage?.kind === 'alert' ? 'alert' : 'status'}
        className={`text-sm ${rowMessage?.kind === 'alert' ? 'text-danger-text' : 'text-muted-foreground'} ${rowMessage ? '' : 'sr-only'}`}
      >
        {rowMessage?.text ?? ''}
      </p>

      {tasks.data?.truncated ? <p role="status" className="text-sm text-warning-text">{t('truncated')}</p> : null}
      <DataTable
        columns={columns}
        data={rows}
        isPending={!ready || tasks.isPending || orgs.isPending}
        isError={tasks.isError || orgs.isError}
        loadingMessage={t('loading')}
        errorMessage={t('error')}
        emptyMessage={t('empty')}
      />
    </div>
  );
}
