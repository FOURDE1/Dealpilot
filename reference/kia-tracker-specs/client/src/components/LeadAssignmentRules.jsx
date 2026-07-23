import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Shuffle, Plus, Play, Pause, Trash2, Edit3, Zap, ArrowLeft, X } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL;

const STRATEGIES = [
  { value: 'round_robin', label: 'Round Robin', desc: 'Distribute leads equally in rotation' },
  { value: 'load_balanced', label: 'Load Balanced', desc: 'Assign to person with fewest active leads' },
  { value: 'source_based', label: 'Source Based', desc: 'Route leads based on their source channel' },
];

const SOURCE_OPTIONS = [
  'walk_in', 'phone', 'web', 'meta_lead_form', 'instagram',
  'google_ads', 'autotrader', 'cargurus', 'kijiji', 'marketplace',
  'kia_oem', 'referral', 'repeat', 'service', 'manual', 'other',
];

const STRATEGY_BADGE = {
  round_robin: 'bg-blue-100 text-blue-700',
  load_balanced: 'bg-green-100 text-green-700',
  source_based: 'bg-purple-100 text-purple-700',
};

export default function LeadAssignmentRules() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editingRule, setEditingRule] = useState(null);

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['assignment-rules'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/assignment-rules`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users-list'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/users`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : data.data || [];
    },
  });

  const saveRule = useMutation({
    mutationFn: async (ruleData) => {
      const url = editingRule
        ? `${API_URL}/assignment-rules/${editingRule.id}`
        : `${API_URL}/assignment-rules`;
      const method = editingRule ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ruleData),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Failed to save rule');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assignment-rules'] });
      setShowModal(false);
      setEditingRule(null);
    },
  });

  const deleteRule = useMutation({
    mutationFn: async (ruleId) => {
      const res = await fetch(`${API_URL}/assignment-rules/${ruleId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete rule');
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['assignment-rules'] }),
  });

  const toggleRule = useMutation({
    mutationFn: async (rule) => {
      const res = await fetch(`${API_URL}/assignment-rules/${rule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !rule.active }),
      });
      if (!res.ok) throw new Error('Failed to toggle rule');
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['assignment-rules'] }),
  });

  const autoAssign = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_URL}/assignment-rules/auto-assign`, { method: 'POST' });
      if (!res.ok) throw new Error('Auto-assign failed');
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      alert(result.message || 'Auto-assign complete');
    },
    onError: (err) => alert(err.message),
  });

  const handleDelete = (ruleId) => {
    if (window.confirm('Delete this rule? Assignment history will be preserved but unlinked.')) {
      deleteRule.mutate(ruleId);
    }
  };

  const activeRulesCount = rules.filter(r => r.active).length;

  return (
    <div>
      <button
        onClick={() => navigate('/leads')}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <ArrowLeft size={16} /> Back to Leads
      </button>

      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-lg">
            <Shuffle className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Lead Assignment Rules</h1>
            <p className="text-sm text-gray-500">
              {activeRulesCount} active rule{activeRulesCount !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => autoAssign.mutate()}
            disabled={autoAssign.isPending || activeRulesCount === 0}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Zap className="w-4 h-4" />
            {autoAssign.isPending ? 'Assigning…' : 'Auto-Assign Now'}
          </button>
          <button
            onClick={() => { setEditingRule(null); setShowModal(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            New Rule
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-16 text-gray-500">Loading…</div>
      ) : rules.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
          <Shuffle className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 text-lg">No assignment rules yet</p>
          <p className="text-gray-400 text-sm mt-1">Create your first rule to start auto-assigning leads</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map(rule => {
            const includedCount = (rule.included_users || []).length;
            const sourceCount = (rule.sources || []).length;
            const strategyLabel = STRATEGIES.find(s => s.value === rule.strategy)?.label || rule.strategy;

            return (
              <div
                key={rule.id}
                className={`bg-white rounded-xl border-2 p-5 ${
                  rule.active ? 'border-blue-200 shadow-sm' : 'border-gray-200 opacity-60'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-gray-900">{rule.name}</h3>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        rule.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {rule.active ? 'Active' : 'Paused'}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STRATEGY_BADGE[rule.strategy] || 'bg-gray-100 text-gray-700'}`}>
                        {strategyLabel}
                      </span>
                    </div>
                    {rule.description && (
                      <p className="text-sm text-gray-500 mt-1">{rule.description}</p>
                    )}
                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-400 flex-wrap">
                      <span>Priority: {rule.priority}</span>
                      <span>Sources: {sourceCount === 0 ? 'All' : sourceCount}</span>
                      <span>Team: {includedCount === 0 ? 'All Users' : `${includedCount} user${includedCount !== 1 ? 's' : ''}`}</span>
                      {rule.max_leads_per_user > 0 && <span>Max/user: {rule.max_leads_per_user}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => toggleRule.mutate(rule)}
                      className={`p-2 rounded-lg ${
                        rule.active ? 'text-amber-600 hover:bg-amber-50' : 'text-green-600 hover:bg-green-50'
                      }`}
                      title={rule.active ? 'Pause rule' : 'Activate rule'}
                    >
                      {rule.active ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => { setEditingRule(rule); setShowModal(true); }}
                      className="p-2 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50"
                      title="Edit rule"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(rule.id)}
                      className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50"
                      title="Delete rule"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <RuleFormModal
          rule={editingRule}
          users={users}
          onSave={(data) => saveRule.mutate(data)}
          onClose={() => { setShowModal(false); setEditingRule(null); }}
          saving={saveRule.isPending}
          error={saveRule.error?.message}
        />
      )}
    </div>
  );
}

function RuleFormModal({ rule, users, onSave, onClose, saving, error }) {
  const [form, setForm] = useState({
    name: rule?.name || '',
    description: rule?.description || '',
    strategy: rule?.strategy || 'round_robin',
    active: rule?.active !== undefined ? rule.active : true,
    priority: rule?.priority || 1,
    sources: rule?.sources || [],
    included_users: rule?.included_users || [],
    max_leads_per_user: rule?.max_leads_per_user || 0,
    source_mappings: rule?.source_mappings || {},
  });

  const toggleArray = (key, value) => {
    setForm(prev => ({
      ...prev,
      [key]: prev[key].includes(value)
        ? prev[key].filter(v => v !== value)
        : [...prev[key], value],
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(form);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">
            {rule ? 'Edit Rule' : 'New Assignment Rule'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Web leads round-robin"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Strategy</label>
            <div className="space-y-2">
              {STRATEGIES.map(s => (
                <label
                  key={s.value}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${
                    form.strategy === s.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                  }`}
                >
                  <input
                    type="radio"
                    name="strategy"
                    value={s.value}
                    checked={form.strategy === s.value}
                    onChange={() => setForm({ ...form, strategy: s.value })}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-sm font-medium text-gray-900">{s.label}</div>
                    <div className="text-xs text-gray-500">{s.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
              <input
                type="number"
                min={1}
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value, 10) || 1 })}
                className="w-full px-3 py-2 rounded-lg border border-gray-300"
              />
              <p className="text-xs text-gray-400 mt-1">Lower = checked first</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max leads per user</label>
              <input
                type="number"
                min={0}
                value={form.max_leads_per_user}
                onChange={(e) => setForm({ ...form, max_leads_per_user: parseInt(e.target.value, 10) || 0 })}
                className="w-full px-3 py-2 rounded-lg border border-gray-300"
              />
              <p className="text-xs text-gray-400 mt-1">0 = unlimited</p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Sources ({form.sources.length === 0 ? 'all sources' : `${form.sources.length} selected`})
            </label>
            <div className="grid grid-cols-3 gap-1 p-2 border border-gray-200 rounded-lg max-h-32 overflow-y-auto">
              {SOURCE_OPTIONS.map(source => (
                <label key={source} className="flex items-center gap-1.5 text-xs cursor-pointer hover:bg-gray-50 px-1 py-0.5 rounded">
                  <input
                    type="checkbox"
                    checked={form.sources.includes(source)}
                    onChange={() => toggleArray('sources', source)}
                    className="w-3 h-3"
                  />
                  <span className="truncate">{source}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Team members ({form.included_users.length === 0 ? 'all users' : `${form.included_users.length} selected`})
            </label>
            <div className="p-2 border border-gray-200 rounded-lg max-h-32 overflow-y-auto">
              {users.length === 0 ? (
                <p className="text-xs text-gray-400 px-1">No users available</p>
              ) : (
                users.map(user => (
                  <label key={user.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 px-1 py-0.5 rounded">
                    <input
                      type="checkbox"
                      checked={form.included_users.includes(user.id)}
                      onChange={() => toggleArray('included_users', user.id)}
                    />
                    <span className="truncate">{user.name || user.email}</span>
                  </label>
                ))
              )}
            </div>
          </div>

          {form.strategy === 'source_based' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Source → user mappings</label>
              <div className="space-y-1.5 p-2 border border-gray-200 rounded-lg max-h-40 overflow-y-auto">
                {(form.sources.length === 0 ? SOURCE_OPTIONS : form.sources).map(source => (
                  <div key={source} className="flex items-center gap-2 text-sm">
                    <span className="w-32 truncate text-xs text-gray-600">{source}</span>
                    <select
                      value={form.source_mappings[source] || ''}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          source_mappings: { ...form.source_mappings, [source]: e.target.value || undefined },
                        })
                      }
                      className="flex-1 px-2 py-1 text-xs rounded border border-gray-300"
                    >
                      <option value="">— None —</option>
                      {users.map(u => (
                        <option key={u.id} value={u.id}>{u.name || u.email}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />
            <span className="text-sm text-gray-700">Active</span>
          </label>

          <div className="flex gap-3 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !form.name.trim()}
              className="flex-1 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : (rule ? 'Save changes' : 'Create rule')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
