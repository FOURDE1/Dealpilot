import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  GitBranch, Plus, Trash2, Play, Pause, Mail, MessageSquare,
  Phone, Bell, Clock, CheckCircle2, ChevronDown, ChevronUp,
  Settings, Users, ArrowDown, Edit3, Save, X, Zap, ListChecks
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL;

const ACTION_TYPES = [
  { key: 'email', label: 'Send Email', icon: 'Mail', color: 'blue' },
  { key: 'sms', label: 'Send SMS', icon: 'MessageSquare', color: 'green' },
  { key: 'call_reminder', label: 'Call Reminder', icon: 'Phone', color: 'purple' },
  { key: 'task', label: 'Create Task', icon: 'ListChecks', color: 'orange' },
  { key: 'notification', label: 'Send Notification', icon: 'Bell', color: 'yellow' },
  { key: 'wait', label: 'Wait / Delay', icon: 'Clock', color: 'gray' },
];

const TRIGGER_TYPES = [
  { key: 'lead_status_change', label: 'Lead Status Changes' },
  { key: 'lead_created', label: 'New Lead Created' },
  { key: 'lead_assigned', label: 'Lead Assigned' },
  { key: 'deal_created', label: 'Deal Created' },
  { key: 'no_response', label: 'No Response After X Days' },
];

const LEAD_STATUSES = ['new', 'assigned', 'contacted', 'qualified', 'nurturing', 'converted', 'lost'];

function formatDelay(minutes) {
  if (minutes === 0) return 'Immediately';
  if (minutes < 60) return minutes + ' min';
  if (minutes < 1440) return (minutes / 60).toFixed(0) + ' hours';
  return (minutes / 1440).toFixed(0) + ' days';
}

function delayToMinutes(value, unit) {
  if (unit === 'minutes') return value;
  if (unit === 'hours') return value * 60;
  if (unit === 'days') return value * 1440;
  return value;
}

function minutesToDelayParts(minutes) {
  if (minutes >= 1440 && minutes % 1440 === 0) return { value: minutes / 1440, unit: 'days' };
  if (minutes >= 60 && minutes % 60 === 0) return { value: minutes / 60, unit: 'hours' };
  return { value: minutes, unit: 'minutes' };
}

function ActionIcon({ type, className = 'w-5 h-5' }) {
  const props = { className };
  switch (type) {
    case 'email': return <Mail {...props} />;
    case 'sms': return <MessageSquare {...props} />;
    case 'call_reminder': return <Phone {...props} />;
    case 'task': return <ListChecks {...props} />;
    case 'notification': return <Bell {...props} />;
    case 'wait': return <Clock {...props} />;
    default: return <Zap {...props} />;
  }
}

function StepEditor({ step, index, templates, onChange, onRemove }) {
  const actionType = ACTION_TYPES.find(a => a.key === step.action_type) || ACTION_TYPES[0];
  const { value: delayVal, unit: delayUnit } = minutesToDelayParts(step.delay_minutes || 0);

  return (
    <div className="relative">
      {index > 0 && (
        <div className="flex flex-col items-center mb-2">
          <div className="w-px h-6 bg-gray-300 dark:bg-gray-600" />
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700 px-3 py-1 rounded-full">
            <Clock className="w-3 h-3" />
            <span>Wait</span>
            <input type="number" min="0" value={delayVal} onChange={(e) => onChange({ ...step, delay_minutes: delayToMinutes(parseInt(e.target.value) || 0, delayUnit) })} className="w-14 px-1 py-0.5 text-center border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-xs" />
            <select value={delayUnit} onChange={(e) => onChange({ ...step, delay_minutes: delayToMinutes(delayVal, e.target.value) })} className="px-1 py-0.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-xs">
              <option value="minutes">min</option>
              <option value="hours">hours</option>
              <option value="days">days</option>
            </select>
          </div>
          <div className="w-px h-2 bg-gray-300 dark:bg-gray-600" />
          <ArrowDown className="w-4 h-4 text-gray-400" />
        </div>
      )}
      <div className={'border-2 rounded-xl p-4 ' + (actionType.color === 'blue' ? 'border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/20' : actionType.color === 'green' ? 'border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/20' : actionType.color === 'purple' ? 'border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-900/20' : actionType.color === 'orange' ? 'border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-900/20' : 'border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50')}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-7 h-7 rounded-full bg-white dark:bg-gray-800 shadow text-sm font-bold text-gray-700 dark:text-gray-300">{index + 1}</span>
            <ActionIcon type={step.action_type} className="w-5 h-5" />
            <span className="font-medium text-gray-900 dark:text-white text-sm">{actionType.label}</span>
          </div>
          <button onClick={onRemove} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Action Type</label>
            <select value={step.action_type} onChange={(e) => onChange({ ...step, action_type: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white">
              {ACTION_TYPES.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
          </div>

          {(step.action_type === 'email' || step.action_type === 'sms') && (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Template</label>
              <select value={step.template_id || ''} onChange={(e) => onChange({ ...step, template_id: e.target.value || null })} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white">
                <option value="">Custom message</option>
                {templates.filter(t => t.type === step.action_type).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}

          {(step.action_type === 'email' || step.action_type === 'sms') && !step.template_id && (
            <>
              {step.action_type === 'email' && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Subject</label>
                  <input type="text" value={step.custom_subject || ''} onChange={(e) => onChange({ ...step, custom_subject: e.target.value })} placeholder="Email subject..." className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white" />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Message Body</label>
                <textarea value={step.custom_body || ''} onChange={(e) => onChange({ ...step, custom_body: e.target.value })} rows={3} placeholder="Use {{first_name}}, {{vehicle_interest}} etc." className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white" />
              </div>
            </>
          )}

          {(step.action_type === 'call_reminder' || step.action_type === 'task') && (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{step.action_type === 'call_reminder' ? 'Call Notes' : 'Task Description'}</label>
              <textarea value={step.custom_body || ''} onChange={(e) => onChange({ ...step, custom_body: e.target.value })} rows={2} placeholder={step.action_type === 'call_reminder' ? 'Reminder to call the lead...' : 'Task description...'} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function WorkflowSequences() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [editingWorkflow, setEditingWorkflow] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const { data: workflows = [], isLoading } = useQuery({
    queryKey: ['workflows'],
    queryFn: async () => {
      const r = await fetch(`${API_URL}/workflows`);
      if (!r.ok) throw new Error('Failed');
      return r.json();
    },
  });

  const { data: templates = [] } = useQuery({
    queryKey: ['templates'],
    queryFn: async () => {
      const r = await fetch(`${API_URL}/templates`);
      if (!r.ok) return [];
      return r.json();
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (workflow) => {
      const isNew = !workflow.id;
      const url = isNew ? `${API_URL}/workflows` : `${API_URL}/workflows/${workflow.id}`;
      const r = await fetch(url, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workflow),
      });
      if (!r.ok) throw new Error('Failed to save');
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
      setEditingWorkflow(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const r = await fetch(`${API_URL}/workflows/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('Failed to delete');
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflows'] }),
  });

  const toggleMutation = useMutation({
    mutationFn: async (id) => {
      const r = await fetch(`${API_URL}/workflows/${id}/toggle`, { method: 'PATCH' });
      if (!r.ok) throw new Error('Failed');
      return r.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflows'] }),
  });

  const startNew = () => {
    setEditingWorkflow({
      name: '',
      description: '',
      trigger_on: 'lead_status_change',
      trigger_config: { from_status: '', to_status: 'assigned' },
      is_active: false,
      steps: [{ action_type: 'email', delay_minutes: 0, template_id: null, custom_subject: '', custom_body: '', config: {} }],
    });
  };

  const startEdit = async (wf) => {
    const r = await fetch(`${API_URL}/workflows/${wf.id}`);
    const full = await r.json();
    setEditingWorkflow({
      ...full,
      steps: full.workflow_steps || [],
    });
  };

  const addStep = () => {
    if (!editingWorkflow) return;
    setEditingWorkflow({
      ...editingWorkflow,
      steps: [...editingWorkflow.steps, { action_type: 'email', delay_minutes: 1440, template_id: null, custom_subject: '', custom_body: '', config: {} }],
    });
  };

  const updateStep = (index, updated) => {
    const steps = [...editingWorkflow.steps];
    steps[index] = updated;
    setEditingWorkflow({ ...editingWorkflow, steps });
  };

  const removeStep = (index) => {
    setEditingWorkflow({
      ...editingWorkflow,
      steps: editingWorkflow.steps.filter((_, i) => i !== index),
    });
  };

  const handleSave = () => {
    if (!editingWorkflow.name.trim()) return;
    saveMutation.mutate(editingWorkflow);
  };

  if (editingWorkflow) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <GitBranch className="w-7 h-7 text-indigo-500" />
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{editingWorkflow.id ? 'Edit Workflow' : 'New Workflow'}</h1>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setEditingWorkflow(null)} className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"><X className="w-4 h-4 inline mr-1" />Cancel</button>
            <button onClick={handleSave} disabled={saveMutation.isPending} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"><Save className="w-4 h-4 inline mr-1" />{saveMutation.isPending ? 'Saving...' : 'Save'}</button>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-200 dark:border-gray-700 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Workflow Name</label>
              <input type="text" value={editingWorkflow.name} onChange={(e) => setEditingWorkflow({ ...editingWorkflow, name: e.target.value })} placeholder="e.g., New Lead Welcome Sequence" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
              <input type="text" value={editingWorkflow.description || ''} onChange={(e) => setEditingWorkflow({ ...editingWorkflow, description: e.target.value })} placeholder="Brief description..." className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Trigger</label>
              <select value={editingWorkflow.trigger_on} onChange={(e) => setEditingWorkflow({ ...editingWorkflow, trigger_on: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm">
                {TRIGGER_TYPES.map(tr => <option key={tr.key} value={tr.key}>{tr.label}</option>)}
              </select>
            </div>
            {editingWorkflow.trigger_on === 'lead_status_change' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">From Status</label>
                  <select value={editingWorkflow.trigger_config?.from_status || ''} onChange={(e) => setEditingWorkflow({ ...editingWorkflow, trigger_config: { ...editingWorkflow.trigger_config, from_status: e.target.value } })} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm">
                    <option value="">Any</option>
                    {LEAD_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">To Status</label>
                  <select value={editingWorkflow.trigger_config?.to_status || ''} onChange={(e) => setEditingWorkflow({ ...editingWorkflow, trigger_config: { ...editingWorkflow.trigger_config, to_status: e.target.value } })} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm">
                    <option value="">Any</option>
                    {LEAD_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><Zap className="w-5 h-5 text-amber-500" /> Workflow Steps</h2>
          <div className="space-y-1">
            {editingWorkflow.steps.map((step, i) => (
              <StepEditor key={i} step={step} index={i} templates={templates} onChange={(updated) => updateStep(i, updated)} onRemove={() => removeStep(i)} />
            ))}
          </div>
          <button onClick={addStep} className="mt-4 w-full py-3 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl text-gray-500 dark:text-gray-400 hover:border-indigo-400 hover:text-indigo-500 transition-colors flex items-center justify-center gap-2 text-sm font-medium">
            <Plus className="w-4 h-4" /> Add Step
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <GitBranch className="w-8 h-8 text-indigo-500" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Workflow Sequences</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Automated multi-step drip campaigns</p>
          </div>
        </div>
        <button onClick={startNew} className="px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2 text-sm font-medium">
          <Plus className="w-4 h-4" /> New Workflow
        </button>
      </div>
      {!isLoading && workflows.length === 0 && (
        <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <GitBranch className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">No workflows yet</h3>
          <p className="text-gray-500 dark:text-gray-400 mb-4">Create your first automated drip campaign</p>
          <button onClick={startNew} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium">Create Workflow</button>
        </div>
      )}

      <div className="space-y-4">
        {workflows.map(wf => (
          <div key={wf.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={wf.is_active ? 'w-3 h-3 rounded-full bg-green-500 animate-pulse' : 'w-3 h-3 rounded-full bg-gray-300 dark:bg-gray-600'} />
                  <div>
                    <h3 className="font-semibold text-gray-900 dark:text-white">{wf.name}</h3>
                    {wf.description && <p className="text-sm text-gray-500 dark:text-gray-400">{wf.description}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">
                    <Zap className="w-3 h-3 inline mr-1" />
                    {TRIGGER_TYPES.find(tr => tr.key === wf.trigger_on)?.label || wf.trigger_on}
                  </span>
                  <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                    {wf.workflow_steps?.[0]?.count || 0} steps
                  </span>
                  <button onClick={() => toggleMutation.mutate(wf.id)} className={wf.is_active ? 'p-2 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 rounded-lg' : 'p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg'} title={wf.is_active ? 'Pause workflow' : 'Activate workflow'}>
                    {wf.is_active ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </button>
                  <button onClick={() => startEdit(wf)} className="p-2 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg">
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button onClick={() => { if (confirm('Delete this workflow?')) deleteMutation.mutate(wf.id); }} className="p-2 text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg">
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <button onClick={() => setExpandedId(expandedId === wf.id ? null : wf.id)} className="p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
                    {expandedId === wf.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
            {expandedId === wf.id && (
              <div className="border-t border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/30 px-5 py-4">
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  <span className="font-medium">Trigger: </span>
                  {wf.trigger_on === 'lead_status_change' && (
                    <span>When lead status changes {wf.trigger_config?.from_status ? 'from ' + wf.trigger_config.from_status : ''} {wf.trigger_config?.to_status ? 'to ' + wf.trigger_config.to_status : ''}</span>
                  )}
                  {wf.trigger_on !== 'lead_status_change' && <span>{wf.trigger_on}</span>}
                </div>
                <div className="mt-2 text-xs text-gray-500 dark:text-gray-500">
                  Created: {new Date(wf.created_at).toLocaleDateString()}
                  {wf.is_active ? ' • Active' : ' • Paused'}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}