import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Plus, Mail, MessageSquare, Pencil, Trash2, Star, Copy, Check, X,
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL;

const TYPE_CONFIG = {
  email: { icon: Mail, label: 'Email', bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200' },
  sms:   { icon: MessageSquare, label: 'SMS', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
};

const CATEGORIES = ['general', 'outreach', 'follow_up', 'appointment', 'nurture'];

const MERGE_FIELDS = [
  '{{first_name}}', '{{last_name}}', '{{email}}', '{{phone}}',
  '{{vehicle_interest}}', '{{monthly_budget}}', '{{current_vehicle}}',
  '{{job_title}}', '{{address}}', '{{salesperson_name}}',
];

const EMPTY_FORM = { name: '', type: 'email', subject: '', body: '', category: 'general', is_default: false };

function TemplateFormModal({ isOpen, onClose, initial, onSave, isPending }) {
  const { t } = useTranslation();
  const [form, setForm] = useState(initial || EMPTY_FORM);
  const [copied, setCopied] = useState(null);

  if (!isOpen) return null;

  const insertField = (field) => {
    setForm(f => ({ ...f, body: f.body + field }));
  };

  const copyField = (field) => {
    navigator.clipboard.writeText(field);
    setCopied(field);
    setTimeout(() => setCopied(null), 1200);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">{initial ? t('templates.editTemplate') : t('templates.createTemplate')}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('templates.form.name')}</label>
            <input
              type="text" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
              placeholder="e.g. Initial Outreach"
            />
          </div>

          {/* Type + Category row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('templates.form.type')}</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
                <option value="email">Email</option>
                <option value="sms">SMS</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('templates.form.category')}</label>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
                {CATEGORIES.map(c => (
                  <option key={c} value={c}>{c.replace('_', ' ').replace(/^\w/, ch => ch.toUpperCase())}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Subject (email only) */}
          {form.type === 'email' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('templates.form.subject')}</label>
              <input
                type="text" value={form.subject}
                onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
                placeholder="Subject line — merge fields work here too"
              />
            </div>
          )}

          {/* Body */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('templates.form.body')}</label>
            <textarea
              value={form.body}
              onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
              rows={8}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm font-mono resize-y"
              placeholder="Type your message... Use {{first_name}}, {{vehicle_interest}}, etc."
            />
          </div>

          {/* Merge field chips */}
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">{t('templates.form.mergeFields')}</p>
            <div className="flex flex-wrap gap-1.5">
              {MERGE_FIELDS.map(f => (
                <button key={f}
                  type="button"
                  onClick={() => insertField(f)}
                  onContextMenu={e => { e.preventDefault(); copyField(f); }}
                  title="Click to insert, right-click to copy"
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-mono bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-blue-700 border border-gray-200 transition-colors"
                >
                  {copied === f ? <Check size={10} className="text-green-500" /> : null}
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Default toggle */}
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={form.is_default}
              onChange={e => setForm(f => ({ ...f, is_default: e.target.checked }))}
              className="rounded border-gray-300"
            />
            <Star size={14} className={form.is_default ? 'text-amber-500' : 'text-gray-400'} />
            {t('templates.form.isDefault')}
          </label>
        </div>

        <div className="flex justify-end gap-2 p-5 border-t border-gray-200">
          <button onClick={onClose}
            className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">
            {t('templates.form.cancel')}
          </button>
          <button
            disabled={!form.name || !form.body || isPending}
            onClick={() => onSave(form)}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {isPending ? '...' : t('templates.form.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TemplatesPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [typeFilter, setTypeFilter] = useState('all');
  const [catFilter, setCatFilter] = useState('all');
  const [modal, setModal] = useState(null); // null | 'create' | template object

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['templates', typeFilter, catFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (typeFilter !== 'all') params.set('type', typeFilter);
      if (catFilter !== 'all') params.set('category', catFilter);
      const res = await fetch(`${API_URL}/templates?${params}`);
      return res.ok ? res.json() : [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (body) => {
      const res = await fetch(`${API_URL}/templates`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed to create');
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['templates'] }); setModal(null); },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...body }) => {
      const res = await fetch(`${API_URL}/templates/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed to update');
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['templates'] }); setModal(null); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const res = await fetch(`${API_URL}/templates/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  });

  const handleSave = (form) => {
    if (modal && modal.id) {
      updateMutation.mutate({ id: modal.id, ...form });
    } else {
      createMutation.mutate(form);
    }
  };

  const emailCount = templates.filter(t => t.type === 'email').length;
  const smsCount = templates.filter(t => t.type === 'sms').length;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('templates.title')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('templates.subtitle')}</p>
        </div>
        <button
          onClick={() => setModal('create')}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} /> {t('templates.create')}
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 mb-6">
        <div className="flex gap-1.5">
          {[
            { id: 'all', label: `${t('templates.filter.all')} (${templates.length})` },
            { id: 'email', label: `Email (${emailCount})` },
            { id: 'sms', label: `SMS (${smsCount})` },
          ].map(f => (
            <button key={f.id}
              onClick={() => setTypeFilter(f.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                typeFilter === f.id
                  ? 'bg-gray-900 border-gray-900 text-white'
                  : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <select
          value={catFilter}
          onChange={e => setCatFilter(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-600"
        >
          <option value="all">{t('templates.filter.allCategories')}</option>
          {CATEGORIES.map(c => (
            <option key={c} value={c}>{c.replace('_', ' ').replace(/^\w/, ch => ch.toUpperCase())}</option>
          ))}
        </select>
      </div>

      {/* Template cards */}
      {isLoading ? (
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600" />
        </div>
      ) : templates.length === 0 ? (
        <div className="text-center py-16">
          <MessageSquare size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 text-sm">{t('templates.empty')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {templates.map(tpl => {
            const cfg = TYPE_CONFIG[tpl.type] || TYPE_CONFIG.email;
            const Icon = cfg.icon;
            return (
              <div key={tpl.id}
                className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow group"
              >
                <div className="p-5">
                  {/* Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${cfg.bg} ${cfg.text}`}>
                        <Icon size={10} /> {cfg.label}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500 capitalize">
                        {tpl.category.replace('_', ' ')}
                      </span>
                      {tpl.is_default && <Star size={12} className="text-amber-500 fill-amber-500" />}
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => setModal({ ...tpl })}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => { if (confirm(t('templates.confirmDelete'))) deleteMutation.mutate(tpl.id); }}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Title */}
                  <h3 className="text-sm font-semibold text-gray-900 mb-1">{tpl.name}</h3>

                  {/* Subject (email) */}
                  {tpl.subject && (
                    <p className="text-xs text-gray-500 mb-2 truncate">
                      <span className="font-medium">Subject:</span> {tpl.subject}
                    </p>
                  )}

                  {/* Body preview */}
                  <p className="text-xs text-gray-500 line-clamp-3 whitespace-pre-wrap">{tpl.body}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create/Edit modal */}
      <TemplateFormModal
        isOpen={modal !== null}
        onClose={() => setModal(null)}
        initial={modal && modal.id ? modal : null}
        onSave={handleSave}
        isPending={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  );
}
