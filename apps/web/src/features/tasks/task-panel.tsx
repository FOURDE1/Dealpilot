import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Label, Select } from '@dealpilot/ui';
import type { LeadStatusT, LeadT, TaskPriorityT, TaskT } from '@dealpilot/schemas';
import { activeMembers, useMembers } from '../team/api.js';
import { leadDisplayName } from '../leads/labels.js';
import { useCreateTask, useTasks, useUpdateTask } from './api.js';
import { BUCKET_CLASSES, BUCKET_KEYS, PRIORITY_CLASSES, PRIORITY_KEYS, tomorrowAtNine } from './labels.js';

/**
 * F-68 — a lead's follow-ups (leads.md §10.1): the open tasks with a
 * one-click complete (a button, like the board — a checkbox that snaps back
 * unchecked as the row leaves is a lie to a screen reader), the completed
 * ones a click away with Reopen, the "no follow-up scheduled" warning while
 * the lead is live and nobody has planned the next touch, and QuickFollowUp
 * — due tomorrow 09:00, "Follow up with {name}", medium priority — as
 * defaults a person can change, never a modal they have to fill.
 */

/** Typed against the lead vocabulary: a renamed status fails the build, not the warning. */
const LIVE_STATUSES: ReadonlySet<LeadStatusT> = new Set<LeadStatusT>(['new', 'chatbot_engaged', 'assigned', 'contacted', 'qualified']);
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const satisfies readonly TaskPriorityT[];
const CLOSED = new Set<TaskT['status']>(['completed', 'cancelled']);

export function TaskPanel({ lead }: { lead: LeadT }) {
  const { t, i18n } = useTranslation('tasks');
  const tasksQ = useTasks(lead.organization_id, { subjectType: 'lead', subjectId: lead.id, open: false });
  const members = useMembers(lead.organization_id);
  const create = useCreateTask();
  const update = useUpdateTask();
  const name = leadDisplayName(lead) ?? lead.phone;
  // The default title follows the language until the person types their own.
  const [editedTitle, setEditedTitle] = useState<string | null>(null);
  const title = editedTitle ?? t('quick_default', { name });
  const [due, setDue] = useState(tomorrowAtNine);
  const [priority, setPriority] = useState<TaskPriorityT>('medium');
  const [assignee, setAssignee] = useState(lead.assigned_to ?? '');
  const [showClosed, setShowClosed] = useState(false);
  const [feedback, setFeedback] = useState<'saved' | 'error' | null>(null);
  const [rowMessage, setRowMessage] = useState<{ kind: 'status' | 'alert'; text: string } | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);

  const all = tasksQ.data?.items ?? [];
  const open = all.filter((x) => !CLOSED.has(x.status));
  const closed = all.filter((x) => CLOSED.has(x.status));
  const needsFollowUp =
    tasksQ.isSuccess && LIVE_STATUSES.has(lead.status) && !open.some((x) => x.task_type === 'follow_up');
  const nameOf = new Map(activeMembers(members.data?.items).map((m) => [m.user_id, m.name]));
  const fmt = (iso: string) => new Date(iso).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    const dueAt = due ? new Date(due) : null;
    try {
      await create.mutateAsync({
        organization_id: lead.organization_id,
        subject_type: 'lead',
        subject_id: lead.id,
        title: title.trim(),
        task_type: 'follow_up',
        priority,
        ...(dueAt && !Number.isNaN(dueAt.getTime()) ? { due_at: dueAt.toISOString() } : {}),
        ...(assignee ? { assigned_to: assignee } : {}),
      });
      setFeedback('saved');
      setEditedTitle(null);
      setDue(tomorrowAtNine());
    } catch {
      setFeedback('error');
    }
  };

  const announce = (kind: 'status' | 'alert', text: string) => {
    setRowMessage({ kind, text });
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

  const row = (task: TaskT) => {
    const reopen = CLOSED.has(task.status);
    return (
      <li key={task.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
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
        <span className={reopen ? 'text-muted-foreground line-through' : ''}>{task.title}</span>
        {task.bucket ? (
          <span className={`rounded-full px-2 py-0.5 text-xs ${BUCKET_CLASSES[task.bucket]}`}>
            {t(BUCKET_KEYS[task.bucket])}
          </span>
        ) : null}
        <span className="text-xs text-muted-foreground">
          {task.due_at ? (task.bucket === 'overdue' ? `${t('overduePrefix')} ${fmt(task.due_at)}` : fmt(task.due_at)) : t('noDue')}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-xs ${PRIORITY_CLASSES[task.priority]}`}>
          {t(PRIORITY_KEYS[task.priority])}
        </span>
        <span className="text-xs text-muted-foreground">
          {task.assigned_to ? (nameOf.get(task.assigned_to) ?? '—') : t('unassigned')}
        </span>
      </li>
    );
  };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4 sm:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold">{t('panel_title')}</h2>
        {closed.length > 0 ? (
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-4 hover:underline max-lg:min-h-11"
            aria-expanded={showClosed}
            onClick={() => setShowClosed((v) => !v)}
          >
            {t(showClosed ? 'panel_hideCompleted' : 'panel_showCompleted', { count: closed.length })}
          </button>
        ) : null}
      </div>

      {tasksQ.isError ? (
        <p role="alert" className="text-sm text-danger-text">{t('error')}</p>
      ) : null}
      {needsFollowUp ? (
        <p role="status" className="text-sm font-medium text-warning-text">{t('panel_warning')}</p>
      ) : null}

      {tasksQ.isSuccess && open.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('panel_empty')}</p>
      ) : (
        <ul className="divide-y divide-border text-sm">{open.map(row)}</ul>
      )}
      {showClosed && closed.length > 0 ? (
        <ul aria-label={t('panel_showCompleted', { count: closed.length })} className="divide-y divide-border border-t border-border text-sm">
          {closed.map(row)}
        </ul>
      ) : null}
      <p
        ref={statusRef}
        tabIndex={-1}
        role={rowMessage?.kind === 'alert' ? 'alert' : 'status'}
        className={`text-sm ${rowMessage?.kind === 'alert' ? 'text-danger-text' : 'text-muted-foreground'} ${rowMessage ? '' : 'sr-only'}`}
      >
        {rowMessage?.text ?? ''}
      </p>

      <form onSubmit={(e) => void submit(e)} className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label={t('quick_title')}>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="task-title">{t('quick_titleField')}</Label>
          <Input id="task-title" required maxLength={200} value={title} onChange={(e) => setEditedTitle(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="task-due">{t('quick_due')}</Label>
          <Input id="task-due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="task-priority">{t('quick_priority')}</Label>
          <Select id="task-priority" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriorityT)}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{t(PRIORITY_KEYS[p])}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="task-assignee">{t('quick_assignee')}</Label>
          <Select id="task-assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">{t('unassigned')}</option>
            {activeMembers(members.data?.items).map((m) => (
              <option key={m.user_id} value={m.user_id}>{m.name}</option>
            ))}
          </Select>
        </div>
        <div className="flex items-end gap-3">
          <Button type="submit" size="sm" disabled={create.isPending || title.trim().length === 0}>
            {t('quick_submit')}
          </Button>
          {feedback === 'saved' ? <span role="status" className="text-sm text-success-text">{t('quick_saved')}</span> : null}
          {feedback === 'error' ? <span role="alert" className="text-sm text-danger-text">{t('quick_error')}</span> : null}
        </div>
      </form>
    </div>
  );
}
