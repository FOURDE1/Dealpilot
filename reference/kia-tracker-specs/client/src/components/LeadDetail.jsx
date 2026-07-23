import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, Phone, Mail, Car, MapPin, User, Calendar, Clock,
  CheckCircle2, Plus, Copy, Check, Zap, Building, Repeat,
  MessageSquare, ArrowDownLeft, ArrowUpRight, Trash2, FileText, X, AlertTriangle,
  ChevronDown, ChevronUp, Pencil,
} from 'lucide-react';
import SpeedToLeadTimer from './SpeedToLeadTimer';
import QuickActionButtons from './QuickActionButtons';
import ActivityHeatmap from './ActivityHeatmap';
import TagBadge from './TagBadge';
import TagPicker from './TagPicker';

const API_URL = import.meta.env.VITE_API_URL;

const STATUS_COLORS = {
  new: { bg: 'bg-blue-100', text: 'text-blue-700', ring: '#3B82F6' },
  contacted: { bg: 'bg-cyan-100', text: 'text-cyan-700', ring: '#06B6D4' },
  qualified: { bg: 'bg-emerald-100', text: 'text-emerald-700', ring: '#10B981' },
  assigned: { bg: 'bg-amber-100', text: 'text-amber-700', ring: '#F59E0B' },
  converted: { bg: 'bg-green-100', text: 'text-green-700', ring: '#22C55E' },
  unresponsive: { bg: 'bg-red-100', text: 'text-red-700', ring: '#EF4444' },
  nurture: { bg: 'bg-orange-100', text: 'text-orange-700', ring: '#F97316' },
  lost: { bg: 'bg-gray-100', text: 'text-gray-700', ring: '#6B7280' },
  expired: { bg: 'bg-gray-100', text: 'text-gray-500', ring: '#9CA3AF' },
};

const ACTIVITY_ICONS = { call: Phone, text: Mail, email: Mail, visit: Car, note: User, task_completed: CheckCircle2, status_change: Clock };

// Communication type → display config (icon, label, color tokens)
const COMM_TYPES = {
  call:  { icon: Phone,         label: 'Call',  ring: '#3B82F6', bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-200' },
  sms:   { icon: MessageSquare, label: 'Text',  ring: '#10B981', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  email: { icon: Mail,          label: 'Email', ring: '#8B5CF6', bg: 'bg-violet-50',  text: 'text-violet-700',  border: 'border-violet-200' },
  visit: { icon: Car,           label: 'Visit', ring: '#F59E0B', bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200' },
  note:  { icon: User,          label: 'Note',  ring: '#6B7280', bg: 'bg-gray-50',    text: 'text-gray-700',    border: 'border-gray-200' },
};
const COMM_FILTERS = [
  { id: 'all',   label: 'All' },
  { id: 'call',  label: 'Calls' },
  { id: 'sms',   label: 'Texts' },
  { id: 'email', label: 'Emails' },
  { id: 'visit', label: 'Visits' },
];

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  if (s === 0) return `${m}m`;
  return `${m}m ${s}s`;
}
const PRIORITY_COLORS = { high: 'bg-red-100 text-red-700', medium: 'bg-yellow-100 text-yellow-700', low: 'bg-gray-100 text-gray-600' };
const TASK_TYPE_COLORS = { follow_up: 'bg-blue-100 text-blue-700', test_drive: 'bg-green-100 text-green-700', appointment: 'bg-purple-100 text-purple-700', other: 'bg-gray-100 text-gray-600' };

function timeAgo(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const mins = Math.floor((now - d) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

function ScoreRing({ score }) {
  const pct = Math.min(score, 100);
  const color = pct > 70 ? '#22C55E' : pct > 40 ? '#F59E0B' : '#EF4444';
  const circ = 2 * Math.PI * 20;
  const offset = circ - (pct / 100) * circ;
  return (
    <div className="relative w-16 h-16">
      <svg viewBox="0 0 48 48" className="w-full h-full -rotate-90">
        <circle cx="24" cy="24" r="20" fill="none" stroke="#E5E7EB" strokeWidth="4" />
        <circle cx="24" cy="24" r="20" fill="none" stroke={color} strokeWidth="4"
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-bold" style={{ color }}>{score}</span>
    </div>
  );
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={handleCopy} className="p-1 rounded hover:bg-gray-100 transition-colors">
      {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} className="text-gray-400" />}
    </button>
  );
}

function formatDueDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) +
    ' \u00B7 ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function TaskCard({ task, leadName, onToggle, isPending }) {
  const overdue = !task.completed && task.due_at && new Date(task.due_at) < new Date();
  const typeColor = TASK_TYPE_COLORS[task.task_type] || TASK_TYPE_COLORS.other;
  const prioColor = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.medium;

  return (
    <div className={`rounded-xl border p-4 shadow-sm transition-all ${
      task.completed ? 'bg-gray-50 border-gray-100 opacity-70' :
      overdue ? 'bg-red-50/50 border-red-200' :
      'bg-white border-gray-200'
    }`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          {task.task_type && (
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${typeColor}`}>
              {task.task_type.replace('_', ' ')}
            </span>
          )}
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${prioColor}`}>
          {task.priority}
        </span>
      </div>

      <h4 className={`text-sm font-bold mb-1 ${task.completed ? 'line-through text-gray-400' : 'text-gray-900'}`}>
        {task.completed && <CheckCircle2 size={14} className="inline text-green-500 mr-1" />}
        {task.title}
      </h4>

      {task.due_at && (
        <p className={`text-xs mb-1 ${overdue && !task.completed ? 'text-red-500 font-medium' : 'text-gray-500'}`}>
          {overdue && !task.completed ? 'OVERDUE: ' : ''}{formatDueDate(task.due_at)}
        </p>
      )}

      {task.notes && (
        <p className="text-xs text-gray-400 italic mb-1">{task.notes}</p>
      )}

      {leadName && (
        <p className="text-xs text-gray-500 flex items-center gap-1">
          <User size={10} /> {leadName}
        </p>
      )}

      {!task.completed && onToggle && (
        <button
          onClick={() => onToggle(task.id)}
          disabled={isPending}
          className="mt-2 flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 disabled:opacity-50"
        >
          <CheckCircle2 size={12} /> Mark Complete
        </button>
      )}
    </div>
  );
}

/* ============= ACTIVITY TAB / COMMUNICATION TIMELINE ============= */
function ActivityTab({ leadId }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [activeQuick, setActiveQuick] = useState(null);
  const [filter, setFilter] = useState('all');
  const [draft, setDraft] = useState({ body: '', subject: '', direction: 'outbound', duration_seconds: '' });
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [renderingTemplate, setRenderingTemplate] = useState(false);

  const { data: communications = [] } = useQuery({
    queryKey: ['lead-communications', leadId],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/leads/${leadId}/communications`);
      return res.ok ? res.json() : [];
    },
  });

  const templateType = activeQuick === 'sms' ? 'sms' : activeQuick === 'email' ? 'email' : null;
  const { data: templates = [] } = useQuery({
    queryKey: ['templates', templateType],
    queryFn: async () => {
      if (!templateType) return [];
      const res = await fetch(`${API_URL}/templates?type=${templateType}`);
      return res.ok ? res.json() : [];
    },
    enabled: !!templateType,
  });

  const applyTemplate = async (tpl) => {
    setRenderingTemplate(true);
    try {
      const res = await fetch(`${API_URL}/templates/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_id: tpl.id, lead_id: leadId }),
      });
      if (res.ok) {
        const rendered = await res.json();
        setDraft(d => ({
          ...d,
          body: rendered.body || '',
          subject: rendered.subject || d.subject,
        }));
      }
    } catch { /* swallow — draft stays as-is */ }
    setRenderingTemplate(false);
    setShowTemplatePicker(false);
  };

  const resetDraft = () => setDraft({ body: '', subject: '', direction: 'outbound', duration_seconds: '' });

  const logMutation = useMutation({
    mutationFn: async (payload) => {
      const res = await fetch(`${API_URL}/leads/${leadId}/communications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to log communication');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-communications', leadId] });
      setActiveQuick(null);
      resetDraft();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (commId) => {
      const res = await fetch(`${API_URL}/leads/${leadId}/communications/${commId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lead-communications', leadId] }),
  });

  const quickActions = [
    { type: 'call',  label: 'Logged Call' },
    { type: 'sms',   label: 'Sent Text' },
    { type: 'email', label: 'Sent Email' },
    { type: 'visit', label: 'Visited' },
  ];

  const submitQuickLog = () => {
    if (!activeQuick) return;
    const payload = { type: activeQuick, body: draft.body || null };
    if (activeQuick === 'visit') {
      payload.direction = 'inbound';
    } else {
      payload.direction = draft.direction;
    }
    if (activeQuick === 'email' && draft.subject) payload.subject = draft.subject;
    if (activeQuick === 'call' && draft.duration_seconds) {
      const n = parseInt(draft.duration_seconds, 10);
      if (Number.isFinite(n) && n > 0) payload.duration_seconds = n;
    }
    logMutation.mutate(payload);
  };

  const filtered = filter === 'all' ? communications : communications.filter(c => c.type === filter);
  const counts = communications.reduce((acc, c) => { acc[c.type] = (acc[c.type] || 0) + 1; return acc; }, {});

  return (
    <div>
      {/* Quick log buttons */}
      <div className="flex flex-wrap gap-2 mb-4">
        {quickActions.map(a => {
          const cfg = COMM_TYPES[a.type];
          const Icon = cfg.icon;
          const isActive = activeQuick === a.type;
          return (
            <button key={a.type}
              onClick={() => { setActiveQuick(isActive ? null : a.type); resetDraft(); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                isActive
                  ? `${cfg.bg} ${cfg.border} ${cfg.text}`
                  : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              <Icon size={14} /> {a.label}
            </button>
          );
        })}
      </div>

      {activeQuick && (
        <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-2">
          {activeQuick !== 'visit' && (
            <div className="flex gap-2">
              {['outbound', 'inbound'].map(dir => (
                <button key={dir}
                  onClick={() => setDraft(d => ({ ...d, direction: dir }))}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border ${
                    draft.direction === dir
                      ? 'bg-blue-50 border-blue-300 text-blue-700'
                      : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  {dir === 'outbound' ? <ArrowUpRight size={12} /> : <ArrowDownLeft size={12} />}
                  {dir.charAt(0).toUpperCase() + dir.slice(1)}
                </button>
              ))}
            </div>
          )}

          {/* Template picker for sms/email */}
          {(activeQuick === 'sms' || activeQuick === 'email') && (
            <div className="relative">
              <button
                onClick={() => setShowTemplatePicker(p => !p)}
                disabled={renderingTemplate}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border bg-white border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-700 transition-colors disabled:opacity-50"
              >
                <FileText size={12} />
                {renderingTemplate ? '...' : t('templates.picker.title')}
              </button>
              {showTemplatePicker && (
                <div className="absolute left-0 top-full mt-1 z-30 w-72 bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden">
                  <div className="max-h-56 overflow-y-auto py-1">
                    {templates.length === 0 ? (
                      <p className="text-xs text-gray-400 py-4 text-center">{t('templates.picker.noTemplates')}</p>
                    ) : templates.map(tpl => (
                      <button key={tpl.id}
                        onClick={() => applyTemplate(tpl)}
                        className="w-full text-left px-3 py-2 hover:bg-blue-50 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-800 truncate">{tpl.name}</span>
                          {tpl.is_default && <span className="text-[9px] font-bold text-amber-600 bg-amber-50 px-1.5 rounded">DEFAULT</span>}
                        </div>
                        <p className="text-xs text-gray-400 truncate mt-0.5">{tpl.body?.slice(0, 80)}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeQuick === 'email' && (
            <input
              type="text"
              value={draft.subject}
              onChange={e => setDraft(d => ({ ...d, subject: e.target.value }))}
              placeholder="Subject (optional)..."
              className="w-full px-3 py-1.5 rounded border border-gray-200 text-sm bg-white"
            />
          )}

          <div className="flex gap-2">
            <input
              type="text"
              value={draft.body}
              onChange={e => setDraft(d => ({ ...d, body: e.target.value }))}
              placeholder="Add a note (optional)..."
              className="flex-1 px-3 py-1.5 rounded border border-gray-200 text-sm bg-white"
              onKeyDown={e => e.key === 'Enter' && submitQuickLog()}
            />
            {activeQuick === 'call' && (
              <input
                type="number"
                min="1"
                value={draft.duration_seconds}
                onChange={e => setDraft(d => ({ ...d, duration_seconds: e.target.value }))}
                placeholder="sec"
                className="w-20 px-3 py-1.5 rounded border border-gray-200 text-sm bg-white"
              />
            )}
            <button
              onClick={submitQuickLog}
              disabled={logMutation.isPending}
              className="px-4 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              Log
            </button>
          </div>
        </div>
      )}

      {/* Filter chips */}
      <div className="flex flex-wrap gap-1.5 mb-4 pb-3 border-b border-gray-100">
        {COMM_FILTERS.map(f => {
          const count = f.id === 'all' ? communications.length : (counts[f.id] || 0);
          const isActive = filter === f.id;
          return (
            <button key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                isActive
                  ? 'bg-gray-900 border-gray-900 text-white'
                  : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
              }`}
            >
              {f.label} <span className={isActive ? 'text-gray-300' : 'text-gray-400'}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Timeline */}
      <div className="space-y-0">
        {filtered.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">
            {communications.length === 0 ? 'No activity yet' : 'No matching activity for this filter'}
          </p>
        ) : filtered.map(comm => {
          const cfg = COMM_TYPES[comm.type] || COMM_TYPES.note;
          const Icon = cfg.icon;
          const duration = formatDuration(comm.duration_seconds);
          return (
            <div key={comm.id} className="group flex gap-3 py-3 border-l-2 pl-4 ml-2 relative" style={{ borderColor: '#E5E7EB' }}>
              <div
                className="absolute -left-[11px] top-3 w-5 h-5 rounded-full bg-white border-2 flex items-center justify-center"
                style={{ borderColor: cfg.ring }}
              >
                <Icon size={10} style={{ color: cfg.ring }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${cfg.bg} ${cfg.text}`}>
                    {cfg.label}
                  </span>
                  {comm.direction && (
                    <span className="flex items-center gap-0.5 text-[10px] text-gray-400 uppercase">
                      {comm.direction === 'outbound' ? <ArrowUpRight size={10} /> : <ArrowDownLeft size={10} />}
                      {comm.direction}
                    </span>
                  )}
                  {duration && <span className="text-[10px] text-gray-400">{duration}</span>}
                  <span className="text-xs text-gray-400" title={new Date(comm.created_at).toLocaleString()}>{timeAgo(comm.created_at)}</span>
                  <button
                    onClick={() => deleteMutation.mutate(comm.id)}
                    className="ml-auto opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-opacity"
                    title="Delete"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                {comm.subject && <p className="text-sm font-medium text-gray-800 mt-1">{comm.subject}</p>}
                {comm.body && <p className="text-sm text-gray-600 mt-0.5 whitespace-pre-wrap">{comm.body}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============= TASKS TAB ============= */
function TasksTab({ leadId, leadName }) {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [taskForm, setTaskForm] = useState({ title: '', due_at: '', priority: 'medium', notes: '' });

  const { data: tasks = [] } = useQuery({
    queryKey: ['lead-tasks', leadId],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/leads/${leadId}/tasks`);
      return res.ok ? res.json() : [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_URL}/leads/${leadId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(taskForm),
      });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-tasks', leadId] });
      setTaskForm({ title: '', due_at: '', priority: 'medium', notes: '' });
      setShowAdd(false);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ taskId, completed }) => {
      const res = await fetch(`${API_URL}/leads/${leadId}/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed }),
      });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-tasks', leadId] });
      queryClient.invalidateQueries({ queryKey: ['lead-activities', leadId] });
    },
  });

  const pending = tasks.filter(t => !t.completed);
  const completed = tasks.filter(t => t.completed);

  return (
    <div>
      <button onClick={() => setShowAdd(!showAdd)}
        className="mb-4 flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100">
        <Plus size={14} /> Add Task
      </button>

      {showAdd && (
        <div className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
          <input type="text" placeholder="Task title..." value={taskForm.title}
            onChange={e => setTaskForm(p => ({ ...p, title: e.target.value }))}
            className="w-full px-3 py-2 rounded border border-gray-200 text-sm bg-white" />
          <div className="grid grid-cols-2 gap-3">
            <input type="datetime-local" value={taskForm.due_at}
              onChange={e => setTaskForm(p => ({ ...p, due_at: e.target.value }))}
              className="px-3 py-2 rounded border border-gray-200 text-sm bg-white" />
            <select value={taskForm.priority}
              onChange={e => setTaskForm(p => ({ ...p, priority: e.target.value }))}
              className="px-3 py-2 rounded border border-gray-200 text-sm bg-white">
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <input type="text" placeholder="Notes (optional)" value={taskForm.notes}
            onChange={e => setTaskForm(p => ({ ...p, notes: e.target.value }))}
            className="w-full px-3 py-2 rounded border border-gray-200 text-sm bg-white" />
          <button onClick={() => createMutation.mutate()} disabled={!taskForm.title || createMutation.isPending}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
            Create Task
          </button>
        </div>
      )}

      {/* Pending tasks */}
      <div className="space-y-3">
        {pending.map(task => (
          <TaskCard key={task.id} task={task} leadName={leadName}
            onToggle={(taskId) => toggleMutation.mutate({ taskId, completed: true })}
            isPending={toggleMutation.isPending} />
        ))}
      </div>

      {/* Completed */}
      {completed.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-gray-400 uppercase mb-2">Completed ({completed.length})</p>
          <div className="space-y-3">
            {completed.map(task => (
              <TaskCard key={task.id} task={task} leadName={leadName} />
            ))}
          </div>
        </div>
      )}

      {pending.length === 0 && completed.length === 0 && (
        <p className="text-sm text-gray-400 py-8 text-center">No tasks yet</p>
      )}
    </div>
  );
}

/* ============= NOTES TAB ============= */
function NotesTab({ leadId }) {
  const queryClient = useQueryClient();
  const [noteText, setNoteText] = useState('');

  const { data: activities = [] } = useQuery({
    queryKey: ['lead-activities', leadId],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/leads/${leadId}/activities`);
      return res.ok ? res.json() : [];
    },
  });

  const notes = activities.filter(a => a.type === 'note');

  const addMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_URL}/leads/${leadId}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'note', note: noteText.trim() }),
      });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-activities', leadId] });
      setNoteText('');
    },
  });

  return (
    <div>
      {/* Add note */}
      <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
        <textarea value={noteText} onChange={e => setNoteText(e.target.value)}
          placeholder="Write a note..."
          rows={3}
          className="w-full px-3 py-2 rounded border border-gray-200 text-sm bg-white resize-none" />
        <button onClick={() => addMutation.mutate()}
          disabled={!noteText.trim() || addMutation.isPending}
          className="mt-2 px-4 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
          Save Note
        </button>
      </div>

      {/* Notes feed */}
      <div className="space-y-3">
        {notes.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">No notes yet</p>
        ) : notes.map(n => (
          <div key={n.id} className="p-3 bg-white rounded-lg border border-gray-200 shadow-sm">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold">N</div>
              <span className="text-xs text-gray-400" title={new Date(n.created_at).toLocaleString()}>{timeAgo(n.created_at)}</span>
            </div>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{n.note}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============= CALENDAR TAB ============= */
const CONDITION_COLORS = {
  excellent: 'bg-green-100 text-green-700',
  good:      'bg-blue-100 text-blue-700',
  fair:      'bg-yellow-100 text-yellow-700',
  poor:      'bg-red-100 text-red-700',
};

function TradeInSection({ lead, leadId }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});

  const hasTrade = lead.has_trade_in || lead.trade_in_make || lead.current_vehicle;

  const startEdit = () => {
    setForm({
      trade_in_year: lead.trade_in_year || '',
      trade_in_make: lead.trade_in_make || '',
      trade_in_model: lead.trade_in_model || '',
      trade_in_trim: lead.trade_in_trim || '',
      trade_in_mileage: lead.trade_in_mileage || '',
      trade_in_condition: lead.trade_in_condition || '',
      trade_in_value: lead.trade_in_value ? (lead.trade_in_value / 100).toFixed(0) : '',
      trade_in_vin: lead.trade_in_vin || '',
      trade_in_color: lead.trade_in_color || '',
      trade_in_notes: lead.trade_in_notes || '',
    });
    setEditing(true);
  };

  const saveMutation = useMutation({
    mutationFn: async (updates) => {
      const res = await fetch(`${API_URL}/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead', leadId] });
      setEditing(false);
    },
  });

  const handleSave = () => {
    const updates = {
      has_trade_in: !!(form.trade_in_make || form.trade_in_year),
      trade_in_year: form.trade_in_year ? parseInt(form.trade_in_year, 10) : null,
      trade_in_make: form.trade_in_make || null,
      trade_in_model: form.trade_in_model || null,
      trade_in_trim: form.trade_in_trim || null,
      trade_in_mileage: form.trade_in_mileage ? parseInt(form.trade_in_mileage, 10) : null,
      trade_in_condition: form.trade_in_condition || null,
      trade_in_value: form.trade_in_value ? Math.round(parseFloat(form.trade_in_value) * 100) : null,
      trade_in_vin: form.trade_in_vin || null,
      trade_in_color: form.trade_in_color || null,
      trade_in_notes: form.trade_in_notes || null,
    };
    saveMutation.mutate(updates);
  };

  const tradeLabel = lead.trade_in_year
    ? `${lead.trade_in_year} ${lead.trade_in_make || ''} ${lead.trade_in_model || ''}`.trim()
    : lead.current_vehicle || null;

  return (
    <div className="mt-4 p-3 bg-gray-50 rounded-lg">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-gray-500 flex items-center gap-1">
          <Repeat size={12} /> {t('tradeIn.title')}
        </p>
        <button onClick={editing ? () => setEditing(false) : startEdit}
          className="text-xs text-blue-600 hover:underline">
          {editing ? t('tradeIn.cancel') : t('tradeIn.edit')}
        </button>
      </div>

      {editing ? (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <input type="number" value={form.trade_in_year} placeholder={t('tradeIn.year')}
              onChange={e => setForm(f => ({ ...f, trade_in_year: e.target.value }))}
              className="px-2 py-1.5 rounded border border-gray-200 text-xs" />
            <input type="text" value={form.trade_in_make} placeholder={t('tradeIn.make')}
              onChange={e => setForm(f => ({ ...f, trade_in_make: e.target.value }))}
              className="px-2 py-1.5 rounded border border-gray-200 text-xs" />
            <input type="text" value={form.trade_in_model} placeholder={t('tradeIn.model')}
              onChange={e => setForm(f => ({ ...f, trade_in_model: e.target.value }))}
              className="px-2 py-1.5 rounded border border-gray-200 text-xs" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input type="text" value={form.trade_in_trim} placeholder={t('tradeIn.trim')}
              onChange={e => setForm(f => ({ ...f, trade_in_trim: e.target.value }))}
              className="px-2 py-1.5 rounded border border-gray-200 text-xs" />
            <input type="text" value={form.trade_in_color} placeholder={t('tradeIn.color')}
              onChange={e => setForm(f => ({ ...f, trade_in_color: e.target.value }))}
              className="px-2 py-1.5 rounded border border-gray-200 text-xs" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input type="number" value={form.trade_in_mileage} placeholder={t('tradeIn.mileage')}
              onChange={e => setForm(f => ({ ...f, trade_in_mileage: e.target.value }))}
              className="px-2 py-1.5 rounded border border-gray-200 text-xs" />
            <select value={form.trade_in_condition}
              onChange={e => setForm(f => ({ ...f, trade_in_condition: e.target.value }))}
              className="px-2 py-1.5 rounded border border-gray-200 text-xs">
              <option value="">{t('tradeIn.condition')}</option>
              <option value="excellent">{t('tradeIn.excellent')}</option>
              <option value="good">{t('tradeIn.good')}</option>
              <option value="fair">{t('tradeIn.fair')}</option>
              <option value="poor">{t('tradeIn.poor')}</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input type="number" value={form.trade_in_value} placeholder={t('tradeIn.value')}
              onChange={e => setForm(f => ({ ...f, trade_in_value: e.target.value }))}
              className="px-2 py-1.5 rounded border border-gray-200 text-xs" />
            <input type="text" value={form.trade_in_vin} placeholder="VIN"
              onChange={e => setForm(f => ({ ...f, trade_in_vin: e.target.value }))}
              className="px-2 py-1.5 rounded border border-gray-200 text-xs" />
          </div>
          <textarea rows={2} value={form.trade_in_notes} placeholder={t('tradeIn.notes')}
            onChange={e => setForm(f => ({ ...f, trade_in_notes: e.target.value }))}
            className="w-full px-2 py-1.5 rounded border border-gray-200 text-xs resize-y" />
          <button onClick={handleSave} disabled={saveMutation.isPending}
            className="w-full py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50">
            {saveMutation.isPending ? '...' : t('tradeIn.save')}
          </button>
        </div>
      ) : hasTrade ? (
        <div className="space-y-1.5 text-xs">
          {tradeLabel && <p className="font-medium text-gray-800">{tradeLabel}</p>}
          {lead.trade_in_trim && <p className="text-gray-500">{lead.trade_in_trim} {lead.trade_in_color && `· ${lead.trade_in_color}`}</p>}
          <div className="flex flex-wrap gap-2 text-gray-500">
            {lead.trade_in_mileage && <span>{lead.trade_in_mileage.toLocaleString()} km</span>}
            {lead.trade_in_condition && (
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${CONDITION_COLORS[lead.trade_in_condition]}`}>
                {t(`tradeIn.${lead.trade_in_condition}`)}
              </span>
            )}
            {lead.trade_in_value && <span className="font-medium text-green-700">${(lead.trade_in_value / 100).toLocaleString()}</span>}
          </div>
          {lead.trade_in_vin && <p className="text-gray-400 font-mono text-[10px]">VIN: {lead.trade_in_vin}</p>}
          {lead.trade_in_notes && <p className="text-gray-500 mt-1">{lead.trade_in_notes}</p>}
        </div>
      ) : (
        <button onClick={startEdit}
          className="flex items-center gap-1.5 text-xs text-blue-600 hover:underline">
          <Plus size={12} /> {t('tradeIn.add')}
        </button>
      )}
    </div>
  );
}

const APPT_TYPES = {
  test_drive:     { icon: Car,      label: 'Test Drive',     bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-200' },
  showroom_visit: { icon: Building, label: 'Showroom Visit', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  follow_up:      { icon: User,     label: 'Follow-Up',      bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200' },
  phone_call:     { icon: Phone,    label: 'Phone Call',      bg: 'bg-violet-50',  text: 'text-violet-700',  border: 'border-violet-200' },
};

const APPT_STATUS_STYLES = {
  scheduled: 'bg-blue-100 text-blue-700',
  confirmed: 'bg-green-100 text-green-700',
  completed: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-100 text-red-600',
  no_show:   'bg-orange-100 text-orange-700',
};

function QuickBookModal({ isOpen, onClose, leadId, leadName, onSave, isPending, conflict }) {
  const { t } = useTranslation();
  const toLocalIso = (d) => {
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
  };
  const startDefault = new Date();
  startDefault.setMinutes(0, 0, 0);
  startDefault.setHours(startDefault.getHours() + 1);
  const endDefault = new Date(startDefault);
  endDefault.setHours(endDefault.getHours() + 1);

  const [form, setForm] = useState({
    title: `${leadName || 'Lead'} — Test Drive`,
    type: 'test_drive',
    start_time: toLocalIso(startDefault),
    end_time: toLocalIso(endDefault),
    description: '',
    location: 'Kia Mont-Laurier Showroom',
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h3 className="text-base font-bold text-gray-900">{t('appointments.quickBook')}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-4 space-y-3">
          {conflict && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">{t('appointments.conflict')}</p>
                {conflict.map(c => <p key={c.id} className="mt-0.5">{c.title}: {new Date(c.start_time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} – {new Date(c.end_time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>)}
              </div>
            </div>
          )}
          <input type="text" value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
            placeholder="Title" />
          <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
            {Object.entries(APPT_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-3">
            <input type="datetime-local" value={form.start_time}
              onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))}
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm" />
            <input type="datetime-local" value={form.end_time}
              onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))}
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm" />
          </div>
          <input type="text" value={form.location}
            onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
            placeholder="Location" />
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-gray-200">
          <button onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">
            {t('appointments.form.cancel')}
          </button>
          <button disabled={!form.title || isPending}
            onClick={() => onSave({
              ...form,
              lead_id: leadId,
              start_time: new Date(form.start_time).toISOString(),
              end_time: new Date(form.end_time).toISOString(),
            })}
            className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
            {isPending ? '...' : t('appointments.form.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function CalendarTab({ leadId, leadName }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDay, setSelectedDay] = useState(null);
  const [showBookModal, setShowBookModal] = useState(false);
  const [bookConflict, setBookConflict] = useState(null);

  const { data: tasks = [] } = useQuery({
    queryKey: ['lead-tasks', leadId],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/leads/${leadId}/tasks`);
      return res.ok ? res.json() : [];
    },
  });

  const { data: appointments = [] } = useQuery({
    queryKey: ['lead-appointments', leadId],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/leads/${leadId}/appointments`);
      return res.ok ? res.json() : [];
    },
  });

  const calToggleMutation = useMutation({
    mutationFn: async ({ taskId }) => {
      const res = await fetch(`${API_URL}/leads/${leadId}/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: true }),
      });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-tasks', leadId] });
    },
  });

  const bookMutation = useMutation({
    mutationFn: async (body) => {
      const res = await fetch(`${API_URL}/appointments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.status === 409) { setBookConflict(data.conflicts); throw new Error('conflict'); }
      if (!res.ok) throw new Error(data.error || 'Failed');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-appointments', leadId] });
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      setShowBookModal(false);
      setBookConflict(null);
    },
  });

  const apptStatusMutation = useMutation({
    mutationFn: async ({ id, status }) => {
      const res = await fetch(`${API_URL}/appointments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-appointments', leadId] });
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
    },
  });

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const tasksByDay = {};
  tasks.forEach(tk => {
    if (tk.due_at) {
      const d = new Date(tk.due_at);
      if (d.getMonth() === month && d.getFullYear() === year) {
        const day = d.getDate();
        if (!tasksByDay[day]) tasksByDay[day] = [];
        tasksByDay[day].push(tk);
      }
    }
  });

  const apptsByDay = {};
  appointments.forEach(ap => {
    const d = new Date(ap.start_time);
    if (d.getMonth() === month && d.getFullYear() === year) {
      const day = d.getDate();
      if (!apptsByDay[day]) apptsByDay[day] = [];
      apptsByDay[day].push(ap);
    }
  });

  const days = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let d = 1; d <= daysInMonth; d++) days.push(d);

  const today = new Date();
  const isToday = (d) => d === today.getDate() && month === today.getMonth() && year === today.getFullYear();

  const dayTasks = selectedDay ? (tasksByDay[selectedDay] || []) : [];
  const dayAppts = selectedDay ? (apptsByDay[selectedDay] || []) : [];
  const hasItems = (d) => !!(tasksByDay[d] || apptsByDay[d]);

  // Upcoming appointments (next 7 days)
  const now = new Date();
  const in7d = new Date(now.getTime() + 7 * 86400000);
  const upcoming = appointments
    .filter(a => ['scheduled', 'confirmed'].includes(a.status) && new Date(a.start_time) >= now && new Date(a.start_time) <= in7d)
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
    .slice(0, 5);

  return (
    <div>
      {/* Quick book button */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-medium text-gray-500 uppercase">{t('appointments.calendarTab')}</span>
        <button onClick={() => { setBookConflict(null); setShowBookModal(true); }}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700">
          <Plus size={12} /> {t('appointments.quickBook')}
        </button>
      </div>

      {/* Upcoming appointments */}
      {upcoming.length > 0 && (
        <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-100">
          <p className="text-[10px] font-semibold text-blue-600 uppercase mb-2">{t('appointments.upcoming')}</p>
          <div className="space-y-2">
            {upcoming.map(ap => {
              const cfg = APPT_TYPES[ap.type] || APPT_TYPES.follow_up;
              const Icon = cfg.icon;
              return (
                <div key={ap.id} className="flex items-center gap-2 text-xs">
                  <Icon size={12} className={cfg.text} />
                  <span className="font-medium text-gray-800 truncate flex-1">{ap.title}</span>
                  <span className="text-gray-500 shrink-0">
                    {new Date(ap.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {' '}{new Date(ap.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </span>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${APPT_STATUS_STYLES[ap.status]}`}>
                    {ap.status.toUpperCase()}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Month grid */}
      <div className="flex items-center justify-between mb-3">
        <button onClick={() => setCurrentMonth(new Date(year, month - 1, 1))} className="p-1 rounded hover:bg-gray-100 text-gray-500">&larr;</button>
        <span className="text-sm font-semibold text-gray-700">
          {currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}
        </span>
        <button onClick={() => setCurrentMonth(new Date(year, month + 1, 1))} className="p-1 rounded hover:bg-gray-100 text-gray-500">&rarr;</button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-gray-400 mb-1">
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => <div key={d}>{d}</div>)}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map((d, i) => (
          <button
            key={i}
            disabled={!d}
            onClick={() => d && setSelectedDay(d === selectedDay ? null : d)}
            className={`aspect-square rounded-lg text-sm flex flex-col items-center justify-center relative transition-colors ${
              !d ? '' :
              d === selectedDay ? 'bg-blue-100 text-blue-700 font-bold' :
              isToday(d) ? 'bg-blue-50 text-blue-600 font-medium' :
              'hover:bg-gray-50 text-gray-700'
            }`}
          >
            {d || ''}
            {d && hasItems(d) && (
              <div className="absolute bottom-0.5 flex gap-0.5">
                {tasksByDay[d] && <div className="w-1 h-1 rounded-full bg-blue-500" />}
                {apptsByDay[d] && <div className="w-1 h-1 rounded-full bg-emerald-500" />}
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Selected day detail */}
      {selectedDay && (
        <div className="mt-4">
          <p className="text-xs font-medium text-gray-500 uppercase mb-3">
            {new Date(year, month, selectedDay).toLocaleDateString('default', { weekday: 'long', month: 'short', day: 'numeric' })}
          </p>

          {dayAppts.length > 0 && (
            <div className="space-y-2 mb-4">
              {dayAppts.map(ap => {
                const cfg = APPT_TYPES[ap.type] || APPT_TYPES.follow_up;
                const Icon = cfg.icon;
                return (
                  <div key={ap.id} className={`p-2.5 rounded-lg border ${cfg.bg} ${cfg.border}`}>
                    <div className="flex items-center gap-2">
                      <Icon size={14} className={cfg.text} />
                      <span className={`text-sm font-semibold ${cfg.text} truncate`}>{ap.title}</span>
                      <span className={`ml-auto px-1.5 py-0.5 rounded text-[9px] font-bold ${APPT_STATUS_STYLES[ap.status]}`}>
                        {ap.status.toUpperCase().replace('_', ' ')}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {new Date(ap.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      {' – '}
                      {new Date(ap.end_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      {ap.location && <> · {ap.location}</>}
                    </p>
                    {['scheduled', 'confirmed'].includes(ap.status) && (
                      <div className="flex gap-1 mt-2">
                        {ap.status === 'scheduled' && (
                          <button onClick={() => apptStatusMutation.mutate({ id: ap.id, status: 'confirmed' })}
                            className="px-2 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700 hover:bg-green-200">Confirm</button>
                        )}
                        <button onClick={() => apptStatusMutation.mutate({ id: ap.id, status: 'completed' })}
                          className="px-2 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600 hover:bg-gray-200">Complete</button>
                        <button onClick={() => apptStatusMutation.mutate({ id: ap.id, status: 'cancelled' })}
                          className="px-2 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-600 hover:bg-red-200">Cancel</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {dayTasks.length > 0 ? (
            <div className="space-y-3">
              {dayTasks.map(tk => (
                <TaskCard key={tk.id} task={tk} leadName={leadName}
                  onToggle={(taskId) => calToggleMutation.mutate({ taskId })}
                  isPending={calToggleMutation.isPending} />
              ))}
            </div>
          ) : dayAppts.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">{t('appointments.nothingOnDay')}</p>
          ) : null}
        </div>
      )}

      {!selectedDay && <p className="text-sm text-gray-400 py-4 text-center mt-4">{t('appointments.clickDay')}</p>}

      <QuickBookModal
        isOpen={showBookModal}
        onClose={() => { setShowBookModal(false); setBookConflict(null); }}
        leadId={leadId}
        leadName={leadName}
        onSave={(body) => bookMutation.mutate(body)}
        isPending={bookMutation.isPending}
        conflict={bookConflict}
      />
    </div>
  );
}

/* ============= LOST REASON MODAL ============= */
function LostReasonModal({ isOpen, onClose, onConfirm }) {
  const { t, i18n } = useTranslation();
  const [selectedId, setSelectedId] = useState(null);
  const [note, setNote] = useState('');
  const isFr = i18n.language?.startsWith('fr');

  const { data: reasons = [] } = useQuery({
    queryKey: ['lost-reasons'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/lost-reasons`);
      return res.ok ? res.json() : [];
    },
    enabled: isOpen,
  });

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('lostReason.title')}</h3>
        <div className="grid grid-cols-3 gap-2 mb-4">
          {reasons.map(r => (
            <button key={r.id}
              onClick={() => setSelectedId(r.id)}
              className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 text-center transition-all ${
                selectedId === r.id
                  ? 'border-red-500 bg-red-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <span className="text-xl">{r.icon}</span>
              <span className="text-[10px] font-medium text-gray-700 leading-tight">
                {isFr && r.name_fr ? r.name_fr : r.name}
              </span>
            </button>
          ))}
        </div>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          rows={2}
          placeholder={t('lostReason.notePlaceholder')}
          className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm resize-y mb-4"
        />
        <div className="flex gap-3">
          <button onClick={() => { onClose(); setSelectedId(null); setNote(''); }}
            className="flex-1 px-4 py-2 rounded-lg border border-gray-300 text-gray-700">
            {t('lostReason.cancel')}
          </button>
          <button onClick={() => { if (selectedId) { onConfirm(selectedId, note); setSelectedId(null); setNote(''); } }}
            disabled={!selectedId}
            className="flex-1 px-4 py-2 rounded-lg bg-red-500 text-white disabled:opacity-50">
            {t('lostReason.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============= MAIN COMPONENT ============= */
export default function LeadDetail() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('activity');
  const [showLostModal, setShowLostModal] = useState(false);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);

  const { data: leadTags = [] } = useQuery({
    queryKey: ['lead-tags', id],
    enabled: !!id,
    queryFn: async () => {
      const res = await fetch(`${API_URL}/leads/${id}/tags`);
      if (!res.ok) return [];
      const json = await res.json();
      return json.data || [];
    },
  });

  const addLeadTag = useMutation({
    mutationFn: async (tagId) => {
      const res = await fetch(`${API_URL}/leads/${id}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag_id: tagId }),
      });
      if (!res.ok) throw new Error('Failed to add tag');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-tags', id] });
      queryClient.invalidateQueries({ queryKey: ['lead-tags-map'] });
    },
  });

  const removeLeadTag = useMutation({
    mutationFn: async (tagId) => {
      const res = await fetch(`${API_URL}/leads/${id}/tags/${tagId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to remove tag');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-tags', id] });
      queryClient.invalidateQueries({ queryKey: ['lead-tags-map'] });
    },
  });

  const { data: lead, isLoading } = useQuery({
    queryKey: ['lead', id],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/leads/${id}`);
      if (!res.ok) throw new Error('Not found');
      return res.json();
    },
  });

  const { data: pendingDuplicates = [] } = useQuery({
    queryKey: ['lead-duplicates', id],
    enabled: !!id,
    queryFn: async () => {
      const res = await fetch(`${API_URL}/duplicates?status=pending`);
      if (!res.ok) return [];
      const all = await res.json();
      return all.filter(d => d.lead_id === id || d.duplicate_of === id);
    },
  });

  const { data: scoreData } = useQuery({
    queryKey: ['lead-score', id],
    enabled: !!id,
    queryFn: async () => {
      const res = await fetch(`${API_URL}/scoring-rules/scores?min=0&max=100`);
      if (!res.ok) return null;
      const all = await res.json();
      return all.find(s => s.lead_id === id) || null;
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (updates) => {
      const res = await fetch(`${API_URL}/leads/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lead', id] }),
  });

  if (isLoading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600" /></div>;
  if (!lead) return <div className="text-center py-20 text-gray-500">Lead not found</div>;

  const fullName = `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Unknown';
  const initials = `${(lead.first_name || '?')[0]}${(lead.last_name || '?')[0]}`.toUpperCase();
  const sc = STATUS_COLORS[lead.status] || STATUS_COLORS.new;
  const daysInPipeline = Math.floor((Date.now() - new Date(lead.created_at)) / 86400000);

  const tabs = [
    { id: 'activity', label: 'Activity' },
    { id: 'tasks', label: 'Tasks' },
    { id: 'notes', label: 'Notes' },
    { id: 'calendar', label: 'Calendar' },
    { id: 'insights', label: 'Insights' },
  ];

  return (
    <div className="lg:flex lg:flex-col lg:h-[calc(100vh-7rem)]">
      {/* Back button */}
      <button onClick={() => navigate('/leads')}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4 shrink-0">
        <ArrowLeft size={16} /> Back to Leads
      </button>

      {/* Duplicate warning banner */}
      {pendingDuplicates.length > 0 && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-3 shrink-0">
          <AlertTriangle size={16} className="text-amber-600 shrink-0" />
          <div className="flex-1 text-sm text-amber-800">
            {t('duplicates.possibleDuplicate', {
              name: (() => {
                const d = pendingDuplicates[0];
                const other = d.lead_id === id ? d.canonical : d.lead;
                return `${other?.first_name || ''} ${other?.last_name || ''}`.trim() || 'another lead';
              })(),
            })}
          </div>
          <button onClick={() => navigate('/leads/duplicates')}
            className="px-3 py-1 rounded-lg text-xs font-medium bg-amber-200 text-amber-800 hover:bg-amber-300 shrink-0">
            {t('duplicates.review')}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:flex-1 lg:min-h-0">

        {/* ===== LEFT COLUMN: Profile ===== */}
        <div className="lg:col-span-1 lg:overflow-y-auto">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            {/* Avatar + Name */}
            <div className="flex flex-col items-center text-center mb-6">
              <div className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold text-white mb-3"
                style={{ backgroundColor: sc.ring }}>
                {initials}
              </div>
              <h1 className="text-xl font-bold text-gray-900">{fullName}</h1>

              {/* Status dropdown — intercepts 'lost' to show reason modal */}
              <select
                value={lead.status}
                onChange={e => {
                  if (e.target.value === 'lost') {
                    setShowLostModal(true);
                  } else {
                    updateMutation.mutate({ status: e.target.value });
                  }
                }}
                className={`mt-2 px-3 py-1 rounded-full text-xs font-bold border-0 cursor-pointer ${sc.bg} ${sc.text}`}
              >
                {Object.keys(STATUS_COLORS).map(s => (
                  <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
            </div>

            {/* Score badge + breakdown */}
            <div className="mb-6">
              <div className="flex justify-center mb-2">
                <ScoreRing score={lead.score || 0} />
              </div>
              {(() => {
                const s = lead.score || 0;
                const color = s >= 80 ? 'bg-green-100 text-green-700' : s >= 40 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700';
                const label = s >= 80 ? t('scoring.hot') : s >= 40 ? t('scoring.warm') : t('scoring.cold');
                return (
                  <div className="text-center">
                    <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${color}`}>{label}</span>
                  </div>
                );
              })()}
              {scoreData && Array.isArray(scoreData.breakdown) && scoreData.breakdown.length > 0 && (
                <div className="mt-3">
                  <button onClick={() => setShowBreakdown(p => !p)}
                    className="flex items-center gap-1 text-[10px] font-medium text-gray-500 hover:text-gray-700 mx-auto">
                    {t('scoring.breakdown')}
                    {showBreakdown ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                  </button>
                  {showBreakdown && (
                    <div className="mt-2 space-y-1">
                      {scoreData.breakdown.map((b, i) => (
                        <div key={i} className="flex items-center justify-between text-[10px] px-2">
                          <span className="text-gray-600 truncate flex-1">{b.rule_name}</span>
                          <span className={`font-bold ml-2 ${b.points > 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {b.points > 0 ? '+' : ''}{b.points}
                          </span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between text-[10px] px-2 pt-1 border-t border-gray-200 font-bold">
                        <span className="text-gray-700">Total</span>
                        <span className="text-gray-900">{scoreData.score}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Contact info */}
            <div className="space-y-3 text-sm">
              {lead.phone && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-gray-600">
                    <Phone size={14} className="text-gray-400" />
                    <span>{lead.phone}</span>
                  </div>
                  <CopyButton text={lead.phone} />
                </div>
              )}
              {lead.email && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-gray-600">
                    <Mail size={14} className="text-gray-400" />
                    <span className="truncate">{lead.email}</span>
                  </div>
                  <CopyButton text={lead.email} />
                </div>
              )}
              {lead.vehicle_interest && (
                <div className="flex items-center gap-2 text-gray-600">
                  <Car size={14} className="text-gray-400" />
                  <span>{lead.vehicle_interest}</span>
                </div>
              )}
              {lead.source && (
                <div className="flex items-center gap-2 text-gray-600">
                  <MapPin size={14} className="text-gray-400" />
                  <span className="capitalize">{lead.source.replace('_', ' ')}</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-gray-600">
                <Calendar size={14} className="text-gray-400" />
                <span>{timeAgo(lead.created_at)}</span>
              </div>
              <div className="flex items-center gap-2 text-gray-600">
                <Clock size={14} className="text-gray-400" />
                <span>{daysInPipeline} days in pipeline</span>
              </div>
            </div>

            {/* Quick Action Buttons */}
            {(lead.phone || lead.email) && (
              <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-100">
                <QuickActionButtons phone={lead.phone} email={lead.email} leadId={lead.id} size="md" className="justify-center" />
              </div>
            )}

            {/* Trade-In Vehicle */}
            <TradeInSection lead={lead} leadId={id} />

            {/* Speed-to-Lead Response Time */}
            <div className="mt-4 p-3 bg-gray-50 rounded-lg">
              <p className="text-xs font-medium text-gray-500 mb-2">{t('speedToLead.responseTime')}</p>
              <SpeedToLeadTimer lead={lead} size="lg" />
              {lead.contact_attempts > 0 && (
                <div className="mt-2 flex items-center gap-2 text-xs text-gray-500 flex-wrap">
                  <span>{t('speedToLead.contactAttempts')}: {lead.contact_attempts}</span>
                  {lead.last_contacted_at && (
                    <span>• {t('speedToLead.lastContact')}: {new Date(lead.last_contacted_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  )}
                </div>
              )}
              {!lead.first_contacted_at && ['new', 'chatbot_engaged', 'assigned'].includes(lead.status) && (
                <button
                  onClick={async () => {
                    const now = new Date().toISOString();
                    const elapsed = Math.floor((Date.now() - new Date(lead.created_at).getTime()) / 1000);
                    await fetch(`${API_URL}/leads/${lead.id}`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        first_contacted_at: now,
                        last_contacted_at: now,
                        response_time_seconds: elapsed,
                        contact_attempts: (lead.contact_attempts || 0) + 1,
                        status: lead.status === 'new' ? 'contacted' : lead.status,
                      }),
                    });
                    queryClient.invalidateQueries({ queryKey: ['lead', lead.id] });
                    queryClient.invalidateQueries({ queryKey: ['leads'] });
                  }}
                  className="mt-2 w-full flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
                >
                  <Zap size={16} />
                  {t('speedToLead.logFirstContact')}
                </button>
              )}
            </div>

            {/* Tags */}
            <div className="mt-4 p-3 bg-gray-50 rounded-lg relative">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-gray-500">{t('tags.section.title')}</p>
                <button
                  type="button"
                  onClick={() => setShowTagPicker(prev => !prev)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  {t('tags.section.edit')}
                </button>
              </div>
              {leadTags.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {leadTags.map(tag => (
                    <TagBadge
                      key={tag.id}
                      tag={tag}
                      size="md"
                      onRemove={(t) => removeLeadTag.mutate(t.id)}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400">{t('tags.section.empty')}</p>
              )}
              {showTagPicker && (
                <div className="absolute right-2 top-full mt-1 z-30">
                  <TagPicker
                    selectedTagIds={leadTags.map(t => t.id)}
                    onToggleTag={(tag) => {
                      if (leadTags.some(lt => lt.id === tag.id)) {
                        removeLeadTag.mutate(tag.id);
                      } else {
                        addLeadTag.mutate(tag.id);
                      }
                    }}
                    onClose={() => setShowTagPicker(false)}
                  />
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="mt-6 space-y-2">
              <button
                onClick={() => navigate('/deal/new')}
                className="w-full py-2.5 rounded-lg bg-blue-600 text-white font-medium text-sm hover:bg-blue-700 transition-colors">
                Convert to Deal
              </button>
              <button
                onClick={() => setShowLostModal(true)}
                className="w-full py-2.5 rounded-lg border-2 border-red-200 text-red-500 font-medium text-sm hover:bg-red-50 transition-colors">
                Mark as Lost
              </button>
            </div>
          </div>
        </div>

        {/* ===== RIGHT COLUMN: Tabs ===== */}
        <div className="lg:col-span-2 lg:overflow-y-auto">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200">
            {/* Tab bar */}
            <div className="flex border-b border-gray-200">
              {tabs.map(tab => (
                <button key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex-1 py-3 text-sm font-medium transition-colors relative ${
                    activeTab === tab.id ? 'text-blue-600' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {tab.label}
                  {activeTab === tab.id && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 rounded-t" />
                  )}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="p-5">
              {activeTab === 'activity' && <ActivityTab leadId={id} />}
              {activeTab === 'tasks' && <TasksTab leadId={id} leadName={fullName} />}
              {activeTab === 'notes' && <NotesTab leadId={id} />}
              {activeTab === 'calendar' && <CalendarTab leadId={id} leadName={fullName} />}
              {activeTab === 'insights' && <ActivityHeatmap leadId={id} />}
            </div>
          </div>
        </div>
      </div>

      <LostReasonModal
        isOpen={showLostModal}
        onClose={() => setShowLostModal(false)}
        onConfirm={(reasonId, note) => {
          updateMutation.mutate({ status: 'lost', lost_reason_id: reasonId, lost_reason_note: note || null });
          setShowLostModal(false);
        }}
      />
    </div>
  );
}
