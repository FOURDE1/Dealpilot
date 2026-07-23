import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  History, Clock, Phone, MessageSquare, Mail, AlertCircle, Flame,
  Timer, RotateCcw, User, Car, CalendarDays, Zap,
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL;

const STATUS_CONFIG = {
  nurture:      { label: 'Nurture',      bg: 'bg-orange-50',  text: 'text-orange-700', border: 'border-orange-200', ring: '#F97316', badge: 'bg-orange-100 text-orange-700' },
  expired:      { label: 'Expired',      bg: 'bg-gray-50',    text: 'text-gray-600',   border: 'border-gray-200',   ring: '#9CA3AF', badge: 'bg-gray-100 text-gray-600' },
  lost:         { label: 'Lost',         bg: 'bg-red-50',     text: 'text-red-700',    border: 'border-red-200',    ring: '#EF4444', badge: 'bg-red-100 text-red-700' },
  unresponsive: { label: 'Unresponsive', bg: 'bg-yellow-50',  text: 'text-yellow-700', border: 'border-yellow-200', ring: '#EAB308', badge: 'bg-yellow-100 text-yellow-700' },
};

const SORT_OPTIONS = [
  { id: 'aging', label: 'Longest Since Contact' },
  { id: 'score', label: 'Highest Score' },
  { id: 'recent', label: 'Most Recently Lost' },
  { id: 'created', label: 'Oldest Leads' },
];

function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  return Math.floor((new Date() - new Date(dateStr)) / 86400000);
}

function getUrgencyLevel(lead) {
  const days = daysSince(lead.last_contacted_at || lead.updated_at);
  if (days >= 90) return { level: 'critical', label: 'Critical', color: 'text-red-600', bg: 'bg-red-100' };
  if (days >= 30) return { level: 'high', label: 'High', color: 'text-orange-600', bg: 'bg-orange-100' };
  if (days >= 14) return { level: 'medium', label: 'Medium', color: 'text-yellow-600', bg: 'bg-yellow-100' };
  return { level: 'low', label: 'Low', color: 'text-emerald-600', bg: 'bg-emerald-100' };
}

function AgingTimer({ dateStr, label }) {
  const days = daysSince(dateStr);
  const isCritical = days >= 90;
  const isOld = days >= 30;
  return (
    <div className={`flex items-center gap-1.5 text-xs ${isCritical ? 'text-red-600' : isOld ? 'text-orange-600' : 'text-gray-500'}`}>
      <Timer size={12} className={isCritical ? 'animate-pulse' : ''} />
      <span>{label}:</span>
      <span className="font-semibold">
        {days === Infinity ? 'Never' : days === 0 ? 'Today' : `${days}d ago`}
      </span>
    </div>
  );
}

function LeadCard({ lead, onReactivate }) {
  const navigate = useNavigate();
  const statusCfg = STATUS_CONFIG[lead.status] || STATUS_CONFIG.lost;
  const urgency = getUrgencyLevel(lead);
  const digits = lead.phone ? lead.phone.replace(/[^\d+]/g, '') : '';

  return (
    <div
      onClick={() => navigate(`/leads/${lead.id}`)}
      className={`bg-white rounded-xl border ${statusCfg.border} p-4 cursor-pointer hover:shadow-md transition-all hover:-translate-y-0.5 group`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white" style={{ background: statusCfg.ring }}>
            {(lead.first_name?.[0] || '?') + (lead.last_name?.[0] || '')}
          </div>
          <div>
            <h3 className="font-semibold text-gray-800 group-hover:text-blue-600 transition-colors">
              {lead.first_name} {lead.last_name}
            </h3>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${statusCfg.badge}`}>{statusCfg.label}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${urgency.bg} ${urgency.color}`}>{urgency.label} Priority</span>
            </div>
          </div>
        </div>
        {lead.score > 0 && (
          <div className="text-right">
            <div className="text-lg font-bold text-gray-700">{lead.score}</div>
            <div className="text-[10px] text-gray-400">score</div>
          </div>
        )}
      </div>

      <div className="space-y-1.5 mb-3">
        {lead.vehicle_interest && (
          <div className="flex items-center gap-1.5 text-xs text-gray-600">
            <Car size={12} /><span>{lead.vehicle_interest}</span>
          </div>
        )}
        {lead.lost_reason && (
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <AlertCircle size={12} /><span className="truncate">{lead.lost_reason}</span>
          </div>
        )}
        <AgingTimer dateStr={lead.last_contacted_at} label="Last contact" />
        <AgingTimer dateStr={lead.updated_at} label="Last update" />
        {lead.contact_attempts > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <Zap size={12} /><span>{lead.contact_attempts} contact attempt{lead.contact_attempts !== 1 ? 's' : ''}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5 pt-3 border-t border-gray-100">
        {digits && (
          <>
            <a href={`tel:${digits}`} onClick={e => e.stopPropagation()} className="flex items-center gap-1 px-2 py-1.5 text-xs rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors">
              <Phone size={12} /> Call
            </a>
            <a href={`sms:${digits}`} onClick={e => e.stopPropagation()} className="flex items-center gap-1 px-2 py-1.5 text-xs rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors">
              <MessageSquare size={12} /> Text
            </a>
          </>
        )}
        {lead.email && (
          <a href={`mailto:${lead.email}`} onClick={e => e.stopPropagation()} className="flex items-center gap-1 px-2 py-1.5 text-xs rounded-lg bg-violet-50 text-violet-700 hover:bg-violet-100 transition-colors">
            <Mail size={12} /> Email
          </a>
        )}
        <button
          onClick={e => { e.stopPropagation(); onReactivate(lead); }}
          className="ml-auto flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg bg-gray-800 text-white hover:bg-gray-700 transition-colors"
        >
          <RotateCcw size={12} /> Reactivate
        </button>
      </div>
    </div>
  );
}

export default function BeBackQueue() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('aging');
  const [searchTerm, setSearchTerm] = useState('');

  const { data: allLeads = [], isLoading } = useQuery({
    queryKey: ['leads'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/leads`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.data || data;
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: async (lead) => {
      const res = await fetch(`${API_URL}/leads/${lead.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'contacted' }),
      });
      if (!res.ok) throw new Error('Failed to reactivate');
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leads'] }),
  });

  const beBackLeads = useMemo(() => {
    const targetStatuses = ['nurture', 'expired', 'lost', 'unresponsive'];
    let filtered = allLeads.filter(l => targetStatuses.includes(l.status));

    if (statusFilter !== 'all') filtered = filtered.filter(l => l.status === statusFilter);

    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      filtered = filtered.filter(l =>
        `${l.first_name} ${l.last_name}`.toLowerCase().includes(q) ||
        (l.vehicle_interest || '').toLowerCase().includes(q) ||
        (l.phone || '').includes(q) ||
        (l.email || '').toLowerCase().includes(q)
      );
    }

    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'aging':   return daysSince(b.last_contacted_at || b.updated_at) - daysSince(a.last_contacted_at || a.updated_at);
        case 'score':   return (b.score || 0) - (a.score || 0);
        case 'recent':  return new Date(b.updated_at) - new Date(a.updated_at);
        case 'created': return new Date(a.created_at) - new Date(b.created_at);
        default:        return 0;
      }
    });

    return filtered;
  }, [allLeads, statusFilter, sortBy, searchTerm]);

  const stats = useMemo(() => {
    const targetStatuses = ['nurture', 'expired', 'lost', 'unresponsive'];
    const all = allLeads.filter(l => targetStatuses.includes(l.status));
    const critical = all.filter(l => getUrgencyLevel(l).level === 'critical').length;
    const byStatus = {};
    all.forEach(l => { byStatus[l.status] = (byStatus[l.status] || 0) + 1; });
    return { total: all.length, critical, byStatus };
  }, [allLeads]);

  const statusFilters = [
    { id: 'all', label: `All (${stats.total})` },
    ...Object.entries(STATUS_CONFIG).map(([key, cfg]) => ({
      id: key, label: `${cfg.label} (${stats.byStatus[key] || 0})`,
    })),
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-800" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <History size={24} className="text-orange-500" />
            <h1 className="text-2xl font-bold text-gray-800">{t('beBack.title', 'Be-Back Queue')}</h1>
          </div>
          <p className="text-sm text-gray-500 mt-1">{t('beBack.subtitle', 'Re-engage nurture, expired, and lost leads')}</p>
        </div>
        {stats.critical > 0 && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
            <Flame size={16} className="text-red-500 animate-pulse" />
            <span className="text-sm font-medium text-red-700">{stats.critical} critical — no contact 90+ days</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
          <button key={key}
            onClick={() => setStatusFilter(statusFilter === key ? 'all' : key)}
            className={`rounded-xl border p-3 text-left transition-all ${
              statusFilter === key ? `${cfg.bg} ${cfg.border} ring-2 ring-offset-1` : 'bg-white border-gray-200 hover:border-gray-300'
            }`}
            style={statusFilter === key ? { '--tw-ring-color': cfg.ring } : {}}>
            <div className={`text-2xl font-bold ${statusFilter === key ? cfg.text : 'text-gray-800'}`}>
              {stats.byStatus[key] || 0}
            </div>
            <div className="text-xs text-gray-500">{cfg.label}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input type="text" placeholder="Search leads..." value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="flex-1 min-w-[200px] max-w-sm pl-3 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
        <select value={sortBy} onChange={e => setSortBy(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white">
          {SORT_OPTIONS.map(opt => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
        </select>
        <div className="flex gap-1 flex-wrap">
          {statusFilters.map(f => (
            <button key={f.id} onClick={() => setStatusFilter(f.id)}
              className={`px-2.5 py-1.5 text-xs rounded-full transition-colors ${
                statusFilter === f.id ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {beBackLeads.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
          <RotateCcw className="mx-auto mb-3 text-gray-300" size={40} />
          <p className="font-medium text-gray-600">{t('beBack.empty', 'No leads in the be-back queue')}</p>
          <p className="text-sm text-gray-400 mt-1">{t('beBack.emptyHint', 'Leads marked as nurture, expired, lost, or unresponsive will appear here')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {beBackLeads.map(lead => (
            <LeadCard key={lead.id} lead={lead} onReactivate={l => reactivateMutation.mutate(l)} />
          ))}
        </div>
      )}

      {beBackLeads.length > 0 && (
        <div className="text-center text-xs text-gray-400 mt-4">
          Showing {beBackLeads.length} of {stats.total} leads in queue
        </div>
      )}
    </div>
  );
}
