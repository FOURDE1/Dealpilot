import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BellRing, Clock, CalendarDays, CheckCircle2, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';

function categorizeTasks(tasks) {
  const now = new Date();
  const todayStr = now.toDateString();
  const weekAhead = new Date(now.getTime() + 7 * 86400000);

  const overdue = [];
  const today = [];
  const week = [];

  tasks.forEach(t => {
    if (t.task_type !== 'follow_up' || t.completed) return;
    if (!t.due_at) return;
    const due = new Date(t.due_at);
    if (Number.isNaN(due.getTime())) return;

    if (due < now && due.toDateString() !== todayStr) {
      overdue.push(t);
    } else if (due.toDateString() === todayStr) {
      today.push(t);
    } else if (due > now && due <= weekAhead) {
      week.push(t);
    }
  });

  const sortByDue = (a, b) => new Date(a.due_at) - new Date(b.due_at);
  return {
    overdue: overdue.sort(sortByDue),
    today: today.sort(sortByDue),
    week: week.sort(sortByDue),
  };
}

function formatDueTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function Section({ variant, icon: Icon, count, labelKey, tasks, expanded, onToggle, iconClass = '' }) {
  const { t } = useTranslation();

  const variantClasses = {
    red: 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100',
    amber: 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100',
    blue: 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100',
  }[variant];

  const detailBorder = {
    red: 'border-red-200',
    amber: 'border-amber-200',
    blue: 'border-blue-200',
  }[variant];

  return (
    <div className={`rounded-lg border ${variantClasses.replace('hover:bg-red-100', '').replace('hover:bg-amber-100', '').replace('hover:bg-blue-100', '')}`}>
      <button
        type="button"
        onClick={onToggle}
        className={`w-full flex items-center justify-between px-4 py-3 rounded-lg transition-colors ${variantClasses}`}
      >
        <div className="flex items-center gap-2">
          <Icon size={18} className={iconClass} />
          <span className="text-sm font-semibold">
            {t(labelKey, { count })}
          </span>
        </div>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {expanded && (
        <div className={`border-t ${detailBorder} px-4 py-2 max-h-56 overflow-y-auto`}>
          <ul className="space-y-1.5">
            {tasks.map(task => (
              <li key={task.id} className="flex items-start justify-between gap-3 text-xs">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{task.lead_name || '—'}</div>
                  <div className="text-[11px] opacity-80 truncate">{task.title}</div>
                </div>
                <div className="text-[11px] whitespace-nowrap opacity-80">{formatDueTime(task.due_at)}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function FollowUpAlertBar({ allTasks = [] }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState({ overdue: false, today: false, week: false });

  const grouped = useMemo(() => categorizeTasks(allTasks), [allTasks]);

  const totalPending = grouped.overdue.length + grouped.today.length + grouped.week.length;

  if (totalPending === 0) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 text-green-700 shadow-sm px-4 py-3 mb-4 flex items-center gap-2">
        <CheckCircle2 size={18} />
        <span className="text-sm font-semibold">{t('followUp.alertBar.allClear')}</span>
      </div>
    );
  }

  const toggle = (key) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="mb-4 space-y-2 shadow-sm">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-[var(--color-text-secondary)] font-semibold px-1">
        <AlertTriangle size={12} />
        {t('followUp.alertBar.title')}
      </div>
      {grouped.overdue.length > 0 && (
        <Section
          variant="red"
          icon={BellRing}
          iconClass="animate-pulse"
          count={grouped.overdue.length}
          labelKey="followUp.alertBar.overdue"
          tasks={grouped.overdue}
          expanded={expanded.overdue}
          onToggle={() => toggle('overdue')}
        />
      )}
      {grouped.today.length > 0 && (
        <Section
          variant="amber"
          icon={Clock}
          count={grouped.today.length}
          labelKey="followUp.alertBar.dueToday"
          tasks={grouped.today}
          expanded={expanded.today}
          onToggle={() => toggle('today')}
        />
      )}
      {grouped.week.length > 0 && (
        <Section
          variant="blue"
          icon={CalendarDays}
          count={grouped.week.length}
          labelKey="followUp.alertBar.dueThisWeek"
          tasks={grouped.week}
          expanded={expanded.week}
          onToggle={() => toggle('week')}
        />
      )}
    </div>
  );
}
