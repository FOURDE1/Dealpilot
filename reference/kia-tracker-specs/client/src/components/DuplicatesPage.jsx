import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Search, RefreshCw, Zap, GitMerge, XCircle, CheckCircle2, AlertTriangle, Phone, Mail, User,
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL;

const MATCH_TYPE_LABELS = {
  phone: 'Phone Match',
  email: 'Email Match',
  name: 'Name Match',
  phone_email: 'Phone + Email',
  phone_name: 'Phone + Name',
  email_name: 'Email + Name',
  phone_email_name: 'Phone + Email + Name',
};

const STATUS_STYLES = {
  pending:   { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Pending' },
  merged:    { bg: 'bg-green-100', text: 'text-green-700', label: 'Merged' },
  dismissed: { bg: 'bg-gray-100',  text: 'text-gray-500',  label: 'Dismissed' },
};

const FILTERS = ['all', 'pending', 'merged', 'dismissed'];

function LeadSide({ lead, otherLead, matchType, t }) {
  if (!lead) return null;
  const phoneMatch = matchType.includes('phone');
  const emailMatch = matchType.includes('email');
  const nameMatch = matchType === 'name' || matchType.includes('name');
  const fullName = `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Unknown';

  return (
    <div className="flex-1 p-3 space-y-1.5">
      <p className={`text-sm font-semibold ${nameMatch ? 'text-green-700' : 'text-gray-900'}`}>
        {fullName}
      </p>
      {lead.phone && (
        <div className="flex items-center gap-1.5 text-xs">
          <Phone size={10} className="text-gray-400" />
          <span className={phoneMatch ? 'font-bold text-green-700' : 'text-gray-600'}>{lead.phone}</span>
        </div>
      )}
      {lead.email && (
        <div className="flex items-center gap-1.5 text-xs">
          <Mail size={10} className="text-gray-400" />
          <span className={emailMatch ? 'font-bold text-green-700' : 'text-gray-600'}>{lead.email}</span>
        </div>
      )}
      <div className="flex items-center gap-2 text-[10px] text-gray-400">
        <span className="capitalize">{lead.source?.replace('_', ' ') || '—'}</span>
        <span>·</span>
        <span className="capitalize">{lead.status}</span>
        <span>·</span>
        <span>{new Date(lead.created_at).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

export default function DuplicatesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('all');
  const [toast, setToast] = useState(null);

  const { data: duplicates = [], isLoading } = useQuery({
    queryKey: ['duplicates', filter],
    queryFn: async () => {
      const params = filter !== 'all' ? `?status=${filter}` : '';
      const res = await fetch(`${API_URL}/duplicates${params}`);
      return res.ok ? res.json() : [];
    },
  });

  const scanMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_URL}/duplicates/scan`, { method: 'POST' });
      if (!res.ok) throw new Error('Scan failed');
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['duplicates'] });
      setToast(t('duplicates.scanComplete', { found: data.found, new: data.new }));
      setTimeout(() => setToast(null), 5000);
    },
  });

  const mergeMutation = useMutation({
    mutationFn: async (id) => {
      const res = await fetch(`${API_URL}/duplicates/${id}/merge`, { method: 'POST' });
      if (!res.ok) throw new Error('Merge failed');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['duplicates'] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
  });

  const dismissMutation = useMutation({
    mutationFn: async (id) => {
      const res = await fetch(`${API_URL}/duplicates/${id}/dismiss`, { method: 'PATCH' });
      if (!res.ok) throw new Error('Dismiss failed');
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['duplicates'] }),
  });

  const counts = {
    all: duplicates.length,
    pending: duplicates.filter(d => d.status === 'pending').length,
    merged: duplicates.filter(d => d.status === 'merged').length,
    dismissed: duplicates.filter(d => d.status === 'dismissed').length,
  };

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-green-600 text-white px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2">
          <Zap size={14} /> {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('duplicates.title')}</h1>
        </div>
        <button onClick={() => scanMutation.mutate()}
          disabled={scanMutation.isPending}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
          {scanMutation.isPending
            ? <RefreshCw size={14} className="animate-spin" />
            : <Search size={14} />}
          {t('duplicates.scanAll')}
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1.5 mb-6">
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              filter === f
                ? 'bg-gray-900 border-gray-900 text-white'
                : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
            }`}>
            {t(`duplicates.${f === 'all' ? 'filterAll' : f}`)}
            <span className={`ml-1 ${filter === f ? 'text-gray-400' : 'text-gray-400'}`}>
              {counts[f] ?? 0}
            </span>
          </button>
        ))}
      </div>

      {/* Duplicate cards */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600" />
        </div>
      ) : duplicates.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
          <CheckCircle2 size={36} className="mx-auto text-gray-300 mb-2" />
          <p className="text-sm text-gray-400">{t('duplicates.noResults')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {duplicates.map(dup => {
            const stStyle = STATUS_STYLES[dup.status] || STATUS_STYLES.pending;
            const isPending = dup.status === 'pending';
            const isDismissed = dup.status === 'dismissed';
            return (
              <div key={dup.id}
                className={`bg-white rounded-xl border shadow-sm overflow-hidden ${isDismissed ? 'opacity-50 border-gray-200' : 'border-gray-200'}`}>
                {/* Match header */}
                <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-100">
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={12} className="text-amber-500" />
                    <span className="text-xs font-semibold text-gray-700">
                      {t(`duplicates.matchType.${dup.match_type}`, MATCH_TYPE_LABELS[dup.match_type] || dup.match_type)}
                    </span>
                    <span className="text-[10px] text-gray-400">
                      {t('duplicates.confidence')}: {dup.confidence}%
                    </span>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${stStyle.bg} ${stStyle.text}`}>
                    {stStyle.label}
                    {dup.merged_at && ` · ${new Date(dup.merged_at).toLocaleDateString()}`}
                    {dup.resolved_at && dup.status === 'dismissed' && ` · ${new Date(dup.resolved_at).toLocaleDateString()}`}
                  </span>
                </div>

                {/* Lead pair */}
                <div className="flex divide-x divide-gray-100">
                  <div className="flex-1 cursor-pointer hover:bg-gray-50" onClick={() => navigate(`/leads/${dup.lead?.id}`)}>
                    <LeadSide lead={dup.lead} otherLead={dup.canonical} matchType={dup.match_type} t={t} />
                  </div>
                  <div className="flex items-center px-2">
                    <GitMerge size={16} className="text-gray-300" />
                  </div>
                  <div className="flex-1 cursor-pointer hover:bg-gray-50" onClick={() => navigate(`/leads/${dup.canonical?.id}`)}>
                    <LeadSide lead={dup.canonical} otherLead={dup.lead} matchType={dup.match_type} t={t} />
                  </div>
                </div>

                {/* Actions */}
                {isPending && (
                  <div className="flex gap-2 px-4 py-2.5 bg-gray-50 border-t border-gray-100">
                    <button
                      onClick={() => { if (confirm(t('duplicates.mergeConfirm'))) mergeMutation.mutate(dup.id); }}
                      disabled={mergeMutation.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50">
                      <GitMerge size={12} /> {t('duplicates.merge')}
                    </button>
                    <button
                      onClick={() => dismissMutation.mutate(dup.id)}
                      disabled={dismissMutation.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 text-xs font-medium hover:bg-gray-100 disabled:opacity-50">
                      <XCircle size={12} /> {t('duplicates.dismiss')}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
