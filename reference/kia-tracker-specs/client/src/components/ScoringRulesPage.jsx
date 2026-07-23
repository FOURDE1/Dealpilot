import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Plus, Pencil, Trash2, RefreshCw, X, ToggleLeft, ToggleRight,
  ArrowUp, ArrowDown, Zap, ChevronDown, ChevronUp,
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL;

// Field type metadata drives which operators appear in the dropdown
const FIELD_TYPES = {
  budget:           'numeric',
  source:           'string',
  status:           'string',
  has_trade_in:     'boolean',
  has_phone:        'boolean',
  has_email:        'boolean',
  vehicle_interest: 'string',
  tags:             'array',
  assigned_to:      'string',
  created_days_ago: 'numeric',
};

const OPERATORS_BY_TYPE = {
  numeric: ['gt','gte','lt','lte','eq','neq','exists','not_exists'],
  string:  ['eq','neq','contains','not_contains','in','not_in','exists','not_exists'],
  boolean: ['exists','not_exists','eq'],
  array:   ['contains','not_contains','exists','not_exists'],
};

const ALL_OPERATORS = [
  { value: 'exists',       labelKey: 'scoring.operators.exists' },
  { value: 'not_exists',   labelKey: 'scoring.operators.not_exists' },
  { value: 'eq',           labelKey: 'scoring.operators.eq' },
  { value: 'neq',          labelKey: 'scoring.operators.neq' },
  { value: 'gt',           labelKey: 'scoring.operators.gt' },
  { value: 'gte',          labelKey: 'scoring.operators.gte' },
  { value: 'lt',           labelKey: 'scoring.operators.lt' },
  { value: 'lte',          labelKey: 'scoring.operators.lte' },
  { value: 'contains',     labelKey: 'scoring.operators.contains' },
  { value: 'not_contains', labelKey: 'scoring.operators.not_contains' },
  { value: 'in',           labelKey: 'scoring.operators.in' },
  { value: 'not_in',       labelKey: 'scoring.operators.not_in' },
];

const FIELD_OPTIONS = Object.keys(FIELD_TYPES);
const NO_VALUE_OPS = ['exists', 'not_exists'];
const EMPTY_FORM = { name: '', description: '', field: 'has_phone', operator: 'exists', value: '', score: 10, is_active: true, priority: 0 };

function scoreColor(score) {
  if (score >= 80) return { bg: 'bg-green-100', text: 'text-green-700', label: 'hot' };
  if (score >= 40) return { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'warm' };
  return { bg: 'bg-red-100', text: 'text-red-700', label: 'cold' };
}

function RuleFormModal({ isOpen, onClose, initial, onSave, isPending }) {
  const { t } = useTranslation();
  const [form, setForm] = useState(initial || EMPTY_FORM);
  const fieldType = FIELD_TYPES[form.field] || 'string';
  const validOps = OPERATORS_BY_TYPE[fieldType] || OPERATORS_BY_TYPE.string;
  const needsValue = !NO_VALUE_OPS.includes(form.operator);

  const changeField = (field) => {
    const newType = FIELD_TYPES[field] || 'string';
    const newValidOps = OPERATORS_BY_TYPE[newType];
    const op = newValidOps.includes(form.operator) ? form.operator : newValidOps[0];
    setForm(f => ({ ...f, field, operator: op }));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">
            {initial ? t('scoring.editRule') : t('scoring.newRule')}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('scoring.form.name')}</label>
            <input type="text" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('scoring.form.description')}</label>
            <textarea rows={2} value={form.description || ''}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm resize-y" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('scoring.form.field')}</label>
              <select value={form.field} onChange={e => changeField(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
                {FIELD_OPTIONS.map(f => (
                  <option key={f} value={f}>{t(`scoring.fields.${f}`)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('scoring.form.operator')}</label>
              <select value={form.operator}
                onChange={e => setForm(f => ({ ...f, operator: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
                {ALL_OPERATORS.filter(o => validOps.includes(o.value)).map(o => (
                  <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
                ))}
              </select>
            </div>
          </div>

          {needsValue && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('scoring.form.value')}</label>
              <input type="text" value={form.value || ''}
                onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
                placeholder={fieldType === 'numeric' ? '50000' : 'facebook, walk_in'} />
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('scoring.score')}
                <span className={`ml-2 text-xs font-bold ${form.score > 0 ? 'text-green-600' : form.score < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                  {form.score > 0 ? `+${form.score}` : form.score}
                </span>
              </label>
              <input type="number" value={form.score}
                onChange={e => setForm(f => ({ ...f, score: parseInt(e.target.value, 10) || 0 }))}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('scoring.priority')}</label>
              <input type="number" value={form.priority}
                onChange={e => setForm(f => ({ ...f, priority: parseInt(e.target.value, 10) || 0 }))}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={form.is_active}
              onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
              className="rounded border-gray-300" />
            {form.is_active ? t('scoring.active') : t('scoring.inactive')}
          </label>
        </div>

        <div className="flex justify-end gap-2 p-5 border-t border-gray-200">
          <button onClick={onClose}
            className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">
            {t('scoring.form.cancel')}
          </button>
          <button disabled={!form.name || !form.field || isPending}
            onClick={() => onSave(form)}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
            {isPending ? '...' : t('scoring.form.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ScoringRulesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['scoring-rules'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/scoring-rules`);
      return res.ok ? res.json() : [];
    },
  });

  const { data: scores = [] } = useQuery({
    queryKey: ['lead-scores'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/scoring-rules/scores`);
      return res.ok ? res.json() : [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (body) => {
      const res = await fetch(`${API_URL}/scoring-rules`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['scoring-rules'] }); setModal(null); },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...body }) => {
      const res = await fetch(`${API_URL}/scoring-rules/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['scoring-rules'] }); setModal(null); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const res = await fetch(`${API_URL}/scoring-rules/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed');
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scoring-rules'] }),
  });

  const recalcMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_URL}/scoring-rules/calculate-all`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['lead-scores'] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      setToast(t('scoring.recalculated', { count: data.updated }));
      setTimeout(() => setToast(null), 4000);
    },
  });

  const handleSave = (form) => {
    if (modal && modal.id) {
      updateMutation.mutate({ id: modal.id, ...form });
    } else {
      createMutation.mutate(form);
    }
  };

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-green-600 text-white px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2 animate-pulse">
          <Zap size={14} /> {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('scoring.title')}</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={() => recalcMutation.mutate()}
            disabled={recalcMutation.isPending}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            <RefreshCw size={14} className={recalcMutation.isPending ? 'animate-spin' : ''} />
            {t('scoring.recalculateAll')}
          </button>
          <button onClick={() => setModal('create')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">
            <Plus size={16} /> {t('scoring.newRule')}
          </button>
        </div>
      </div>

      {/* Rules Table */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600" />
        </div>
      ) : rules.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <Zap size={36} className="mx-auto text-gray-300 mb-2" />
          <p className="text-gray-500 text-sm">{t('scoring.noRules')}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-8">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-left text-xs font-medium text-gray-500 uppercase">
                <th className="px-4 py-3 w-10"></th>
                <th className="px-4 py-3">{t('scoring.form.name')}</th>
                <th className="px-4 py-3">{t('scoring.form.field')}</th>
                <th className="px-4 py-3">{t('scoring.form.operator')}</th>
                <th className="px-4 py-3">{t('scoring.form.value')}</th>
                <th className="px-4 py-3 text-center">{t('scoring.score')}</th>
                <th className="px-4 py-3 text-center">{t('scoring.priority')}</th>
                <th className="px-4 py-3 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {rules.map(rule => {
                const sc = rule.score > 0 ? 'bg-green-100 text-green-700' : rule.score < 0 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600';
                return (
                  <tr key={rule.id} className={`border-b border-gray-50 hover:bg-gray-50/50 ${rule.is_active ? '' : 'opacity-40'}`}>
                    <td className="px-4 py-3">
                      <button onClick={() => updateMutation.mutate({ id: rule.id, is_active: !rule.is_active })}
                        className="text-gray-400 hover:text-gray-700">
                        {rule.is_active ? <ToggleRight size={20} className="text-green-500" /> : <ToggleLeft size={20} />}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{rule.name}</p>
                      {rule.description && <p className="text-xs text-gray-400 mt-0.5">{rule.description}</p>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">{t(`scoring.fields.${rule.field}`, rule.field)}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">{t(`scoring.operators.${rule.operator}`, rule.operator)}</td>
                    <td className="px-4 py-3 text-xs text-gray-600 font-mono">
                      {NO_VALUE_OPS.includes(rule.operator) ? '—' : rule.value}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-bold ${sc}`}>
                        {rule.score > 0 ? <ArrowUp size={10} /> : rule.score < 0 ? <ArrowDown size={10} /> : null}
                        {rule.score > 0 ? '+' : ''}{rule.score}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-xs text-gray-500">{rule.priority}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => setModal({ ...rule })}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => deleteMutation.mutate(rule.id)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Lead Scores Leaderboard */}
      <div className="mt-2">
        <h2 className="text-lg font-bold text-gray-900 mb-4">{t('scoring.leaderboard')}</h2>
        {scores.length === 0 ? (
          <div className="text-center py-10 bg-white rounded-xl border border-gray-200">
            <p className="text-sm text-gray-400">{t('scoring.noScores')}</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-left text-xs font-medium text-gray-500 uppercase">
                  <th className="px-4 py-3 w-16">{t('scoring.rank')}</th>
                  <th className="px-4 py-3">{t('scoring.leadName')}</th>
                  <th className="px-4 py-3 text-center">{t('scoring.score')}</th>
                  <th className="px-4 py-3">{t('scoring.status')}</th>
                  <th className="px-4 py-3">{t('scoring.topRule')}</th>
                </tr>
              </thead>
              <tbody>
                {scores.map((row, idx) => {
                  const lead = row.leads;
                  const color = scoreColor(row.score);
                  const topRule = Array.isArray(row.breakdown) && row.breakdown.length > 0
                    ? row.breakdown.reduce((best, r) => r.points > best.points ? r : best, row.breakdown[0])
                    : null;
                  return (
                    <tr key={row.id}
                      onClick={() => navigate(`/leads/${row.lead_id}`)}
                      className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer">
                      <td className="px-4 py-3 text-center font-bold text-gray-400">{idx + 1}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{lead?.first_name} {lead?.last_name}</p>
                        <p className="text-xs text-gray-400">{lead?.status} · {lead?.source}</p>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold ${color.bg} ${color.text}`}>
                          {row.score}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">{lead?.vehicle_interest || '—'}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {topRule
                          ? <span>{topRule.rule_name} <span className="font-bold text-green-600">+{topRule.points}</span></span>
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <RuleFormModal
        isOpen={modal !== null}
        onClose={() => setModal(null)}
        initial={modal && modal.id ? modal : null}
        onSave={handleSave}
        isPending={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  );
}
