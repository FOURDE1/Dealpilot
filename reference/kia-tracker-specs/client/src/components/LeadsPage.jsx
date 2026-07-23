import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useSearchParams } from 'react-router-dom';
import {
  UserPlus, Search, Phone, Mail, Clock, Plus, User, TrendingUp, TrendingDown, Flame,
  LayoutGrid, List, Bell, BellRing, CalendarPlus, AlertTriangle,
  ChevronDown, ChevronUp, X, Star, Save, Filter, Bookmark,
} from 'lucide-react';
import LeadKanbanBoard from './LeadKanbanBoard';
import FollowUpAlertBar from './FollowUpAlertBar';
import QuickFollowUpModal from './QuickFollowUpModal';
import SpeedToLeadTimer from './SpeedToLeadTimer';
import BulkActionBar from './BulkActionBar';
import TagBadge from './TagBadge';
import QuickActionButtons from './QuickActionButtons';

const API_URL = import.meta.env.VITE_API_URL;

const STATUS_COLORS = {
  new: '#3B82F6',
  chatbot_engaged: '#8B5CF6',
  assigned: '#F59E0B',
  contacted: '#06B6D4',
  qualified: '#10B981',
  converted: '#22C55E',
  unresponsive: '#EF4444',
  nurture: '#F97316',
  expired: '#6B7280',
  lost: '#EF4444',
};

const SOURCE_CONFIG = {
  walk_in:        { icon: '\u{1F6B6}', label: 'Walk-in',       color: '#10B981', bg: '#ECFDF5' },
  phone:          { icon: '\u{1F4DE}', label: 'Phone',         color: '#3B82F6', bg: '#EFF6FF' },
  web:            { icon: '\u{1F310}', label: 'Website',       color: '#8B5CF6', bg: '#F5F3FF' },
  meta_lead_form: { icon: '\u{1F4D8}', label: 'Facebook',      color: '#1877F2', bg: '#E7F0FE' },
  instagram:      { icon: '\u{1F4F7}', label: 'Instagram',     color: '#E1306C', bg: '#FDE8EF' },
  google_ads:     { icon: '\u{1F4E3}', label: 'Google Ads',    color: '#EA4335', bg: '#FEE8E7' },
  autotrader:     { icon: '\u{1F697}', label: 'AutoTrader',    color: '#E56B1F', bg: '#FEF0E5' },
  cargurus:       { icon: '\u{1F50D}', label: 'CarGurus',      color: '#6DC24B', bg: '#EEFBE9' },
  kijiji:         { icon: '\u{1F7E2}', label: 'Kijiji',        color: '#373373', bg: '#EDEDFC' },
  marketplace:    { icon: '\u{1F3EA}', label: 'Marketplace',   color: '#0084FF', bg: '#E6F2FF' },
  kia_oem:        { icon: '\u{1F3ED}', label: 'Kia OEM',       color: '#BB162B', bg: '#FCE8EB' },
  referral:       { icon: '\u{1F91D}', label: 'Referral',      color: '#F59E0B', bg: '#FFFBEB' },
  repeat:         { icon: '\u{1F504}', label: 'Repeat Client', color: '#06B6D4', bg: '#ECFEFF' },
  service:        { icon: '\u{1F527}', label: 'Service Dept',  color: '#64748B', bg: '#F1F5F9' },
  manual:         { icon: '\u{270F}\u{FE0F}', label: 'Manual',        color: '#6B7280', bg: '#F3F4F6' },
  other:          { icon: '\u{1F4CC}', label: 'Other',         color: '#6B7280', bg: '#F3F4F6' },
};

function getSourceInfo(source) {
  return SOURCE_CONFIG[source] || SOURCE_CONFIG.other;
}

function SourceBadge({ source, size = 'sm' }) {
  const info = getSourceInfo(source);
  const isSmall = size === 'sm';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${isSmall ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5'}`}
      style={{ backgroundColor: info.bg, color: info.color }}
    >
      <span className={isSmall ? 'text-[10px]' : 'text-xs'}>{info.icon}</span>
      {info.label}
    </span>
  );
}

// === AI Lead Scoring System ===
function calculateLeadScore(lead) {
  let score = 0;
  const breakdown = [];

  // Source quality (0-25)
  const sourceScores = { website: 25, referral: 22, walk_in: 20, phone: 18, service: 15, manual: 5, other: 10 };
  const srcPts = sourceScores[lead.source] || 10;
  score += srcPts;
  breakdown.push({ label: 'Source', pts: srcPts, max: 25 });

  // Contact completeness (0-20)
  let contact = 0;
  if (lead.phone) contact += 8;
  if (lead.email) contact += 7;
  if (lead.vehicle_interest) contact += 5;
  score += contact;
  breakdown.push({ label: 'Contact Info', pts: contact, max: 20 });

  // Engagement / recency (0-25)
  const daysOld = Math.floor((Date.now() - new Date(lead.created_at)) / 86400000);
  const recency = daysOld <= 1 ? 25 : daysOld <= 3 ? 20 : daysOld <= 7 ? 15 : daysOld <= 14 ? 10 : daysOld <= 30 ? 5 : 0;
  score += recency;
  breakdown.push({ label: 'Recency', pts: recency, max: 25 });

  // Status progression (0-20)
  const statusScores = { new: 20, contacted: 15, qualified: 18, negotiation: 12, won: 10, lost: 0 };
  const stPts = statusScores[lead.status] || 5;
  score += stPts;
  breakdown.push({ label: 'Status', pts: stPts, max: 20 });

  // Assignment bonus (0-10)
  const assignPts = lead.assigned_to ? 10 : 0;
  score += assignPts;
  breakdown.push({ label: 'Assigned', pts: assignPts, max: 10 });

  return { score: Math.min(score, 100), breakdown };
}

function getScoreColor(score) {
  if (score >= 80) return { bg: '#DCFCE7', text: '#16A34A', ring: '#22C55E' };
  if (score >= 60) return { bg: '#FEF9C3', text: '#CA8A04', ring: '#EAB308' };
  if (score >= 40) return { bg: '#FED7AA', text: '#EA580C', ring: '#F97316' };
  return { bg: '#FEE2E2', text: '#DC2626', ring: '#EF4444' };
}

function getScoreTrend(lead) {
  const daysOld = Math.floor((Date.now() - new Date(lead.created_at)) / 86400000);
  if (daysOld <= 1) return { icon: 'up', label: 'Hot - New lead' };
  if (daysOld <= 3) return { icon: 'up', label: 'Warm - Recent' };
  if (daysOld <= 7) return { icon: 'flat', label: 'Cooling down' };
  return { icon: 'down', label: 'Cold - Needs attention' };
}

function ScoreTooltip({ score, breakdown, trend }) {
  return (
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-gray-900 text-white text-xs rounded-lg p-3 shadow-xl z-50">
      <div className="font-bold mb-1">AI Score: {score}/100</div>
      <div className="text-gray-300 mb-2">{trend.label}</div>
      {breakdown.map((b, i) => (
        <div key={i} className="flex justify-between mb-0.5">
          <span>{b.label}</span>
          <span>{b.pts}/{b.max}</span>
        </div>
      ))}
      <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
    </div>
  );
}

function LeadCard({ lead, onClick, salespeopleMap, followUp, onScheduleFollowUp, selected, onToggleSelect, index, tags }) {
  const { t } = useTranslation();
  const [showTooltip, setShowTooltip] = useState(false);
  const { score, breakdown } = calculateLeadScore(lead);
  const colors = getScoreColor(score);
  const trend = getScoreTrend(lead);
  const fullName = `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || t('leads.unknown');
  const statusColor = STATUS_COLORS[lead.status] || '#6B7280';

  return (
    <div
      onClick={onClick}
      className={`bg-white border rounded-xl p-4 shadow-sm cursor-pointer hover:shadow-md transition-shadow ${
        selected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200'
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-start gap-2 min-w-0">
          <input
            type="checkbox"
            checked={!!selected}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onToggleSelect?.(lead.id, index, e.nativeEvent.shiftKey)}
            className="mt-1 w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
            aria-label="Select lead"
          />
          <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900">{fullName}</div>
          <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
            {lead.phone && <span className="flex items-center gap-1"><Phone size={12} />{lead.phone}</span>}
            {lead.email && <span className="flex items-center gap-1"><Mail size={12} />{lead.email}</span>}
            <QuickActionButtons phone={lead.phone} email={lead.email} leadId={lead.id} size="xs" />
          </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="relative"
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
          >
            <div
              className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold cursor-help"
              style={{ backgroundColor: colors.bg, color: colors.text }}
            >
              {trend.icon === 'up' && <TrendingUp size={10} />}
              {trend.icon === 'down' && <TrendingDown size={10} />}
              {score >= 80 && <Flame size={10} />}
              {score}
            </div>
            {showTooltip && <ScoreTooltip score={score} breakdown={breakdown} trend={trend} />}
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: statusColor }}>
            {lead.status}
          </span>
        </div>
      </div>
      {lead.assigned_to && salespeopleMap?.[lead.assigned_to] && (
        <div className="flex items-center gap-1.5 mb-2 text-xs">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">
            <User size={10} />
            {salespeopleMap[lead.assigned_to]}
          </span>
        </div>
      )}
      {tags && tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {tags.map(tag => <TagBadge key={tag.id} tag={tag} size="sm" />)}
        </div>
      )}
      <div className="flex items-center justify-between text-xs text-gray-500">
        <div className="flex items-center gap-3">
          {lead.vehicle_interest && <span>{lead.vehicle_interest}</span>}
          {lead.source && <SourceBadge source={lead.source} />}
        </div>
        <SpeedToLeadTimer lead={lead} size="sm" />
      </div>
      <div className="mt-2 pt-2 border-t border-gray-100">
        {followUp ? (
          <div className={`flex items-center gap-1.5 text-xs ${
            followUp.isOverdue ? 'text-red-600 font-semibold' :
            followUp.isToday ? 'text-amber-600 font-medium' : 'text-blue-600'
          }`}>
            {followUp.isOverdue ? (
              <BellRing className="w-3.5 h-3.5 animate-pulse" />
            ) : followUp.isToday ? (
              <Clock className="w-3.5 h-3.5" />
            ) : (
              <CalendarPlus className="w-3.5 h-3.5" />
            )}
            <span>
              {followUp.isOverdue ? t('followUp.card.overdue') :
               followUp.isToday ? t('followUp.card.dueToday') :
               t('followUp.card.scheduledFor')}
              {': '}
              {new Date(followUp.due_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        ) : (
          ['new', 'assigned', 'contacted', 'qualified'].includes(lead.status) && (
            <button
              onClick={(e) => { e.stopPropagation(); onScheduleFollowUp?.(); }}
              className="flex items-center gap-1.5 text-xs text-amber-500 hover:text-amber-700 transition-colors"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>{t('followUp.card.noFollowUp')}</span>
              <CalendarPlus className="w-3 h-3 ml-1" />
            </button>
          )
        )}
      </div>
    </div>
  );
}

function AddLeadModal({ isOpen, onClose, onCreated }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    first_name: '', last_name: '', phone: '', email: '',
    source: 'walk_in', vehicle_interest: '', notes: '', assigned_to: '',
  });
  const [submitError, setSubmitError] = useState('');

  const { data: salespeople } = useQuery({
    queryKey: ['salespeople'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/salespeople`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : data.data || [];
    },
    enabled: isOpen,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const body = {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || null,
        source: form.source || 'manual',
        vehicle_interest: form.vehicle_interest.trim() || null,
        notes: form.notes.trim() || null,
      };
      const res = await fetch(`${API_URL}/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Failed to create lead');
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      setForm({ first_name: '', last_name: '', phone: '', email: '', source: 'walk_in', vehicle_interest: '', notes: '', assigned_to: '' });
      setSubmitError('');
      onCreated?.(data);
      onClose();
    },
    onError: (err) => {
      setSubmitError(err.message);
    },
  });

  if (!isOpen) return null;

  const field = (name, label, type = 'text', placeholder = '') => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        type={type}
        value={form[name]}
        onChange={(e) => setForm(prev => ({ ...prev, [name]: e.target.value }))}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('leads.addLead')}</h2>

          {submitError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
              {submitError}
            </div>
          )}

          <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate(); }} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {field('first_name', t('contacts.firstName'), 'text', 'John')}
              {field('last_name', t('contacts.lastName'), 'text', 'Smith')}
            </div>
            {field('phone', t('contacts.phone'), 'tel', '(514) 555-1234')}
            {field('email', t('contacts.email'), 'email', 'john@example.com')}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('contacts.source.label')}</label>
              <select
                value={form.source}
                onChange={(e) => setForm(prev => ({ ...prev, source: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-900"
              >
                <option value="walk_in">{t('contacts.source.walk_in')}</option>
                <option value="phone">{t('contacts.source.phone')}</option>
                <option value="web">{t('contacts.source.web')}</option>
                <option value="meta_lead_form">Facebook Lead</option>
                <option value="instagram">Instagram</option>
                <option value="google_ads">Google Ads</option>
                <option value="autotrader">AutoTrader</option>
                <option value="cargurus">CarGurus</option>
                <option value="kijiji">Kijiji</option>
                <option value="marketplace">FB Marketplace</option>
                <option value="kia_oem">Kia OEM</option>
                <option value="referral">{t('contacts.source.referral')}</option>
                <option value="repeat">Repeat Client</option>
                <option value="service">Service Dept</option>
                <option value="other">{t('contacts.source.other')}</option>
              </select>
            </div>

            {field('vehicle_interest', t('leads.vehicleInterest'), 'text', '2024 Kia Sportage EX')}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('leads.assignedTo')}</label>
              <select
                value={form.assigned_to}
                onChange={(e) => setForm(prev => ({ ...prev, assigned_to: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-900"
              >
                <option value="">— Unassigned —</option>
                {(salespeople || []).filter(s => s.active !== false).map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('contacts.notes')}</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm(prev => ({ ...prev, notes: e.target.value }))}
                rows={3}
                placeholder="Any additional notes..."
                className="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex gap-3 pt-3">
              <button
                type="button"
                onClick={() => { onClose(); setSubmitError(''); }}
                className="flex-1 px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                {t('contacts.cancel')}
              </button>
              <button
                type="submit"
                disabled={!form.first_name || !form.last_name || !form.phone || createMutation.isPending}
                className="flex-1 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {createMutation.isPending ? '...' : t('leads.addLead')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

const STATUSES = ['new','assigned','contacted','qualified','unresponsive','nurture','converted','lost'];
const SOURCES_LIST = ['manual','website','facebook','meta_lead_form','walk_in','phone','referral','google_ads','fluent_form','chatbot'];

function useUrlFilters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const get = (key) => searchParams.get(key) || '';
  const getList = (key) => { const v = searchParams.get(key); return v ? v.split(',').filter(Boolean) : []; };
  const set = (key, val) => {
    const next = new URLSearchParams(searchParams);
    if (!val || (Array.isArray(val) && val.length === 0)) next.delete(key);
    else next.set(key, Array.isArray(val) ? val.join(',') : val);
    setSearchParams(next, { replace: true });
  };
  const clear = () => setSearchParams({}, { replace: true });
  const applyAll = (filters) => {
    const next = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v && (!Array.isArray(v) || v.length > 0)) next.set(k, Array.isArray(v) ? v.join(',') : String(v));
    });
    setSearchParams(next, { replace: true });
  };
  return { get, getList, set, clear, applyAll, searchParams };
}

export default function LeadsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const filters = useUrlFilters();
  const [showAddModal, setShowAddModal] = useState(false);
  const [viewMode, setViewMode] = useState('list');
  const [followUpModal, setFollowUpModal] = useState({ open: false, leadId: null, leadName: '', leadIds: null });
  const [selectedIds, setSelectedIds] = useState([]);
  const [lastSelectedIndex, setLastSelectedIndex] = useState(null);
  const [tagFilterIds, setTagFilterIds] = useState([]);
  const [showTagFilter, setShowTagFilter] = useState(false);
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showSavedList, setShowSavedList] = useState(false);
  const [saveForm, setSaveForm] = useState({ name: '', is_default: false, is_shared: false });

  const search = filters.get('search');
  const statusFilter = filters.getList('status');
  const sourceFilter = filters.getList('source');
  const assignedTo = filters.get('assigned_to');
  const scoreMin = filters.get('score_min');
  const scoreMax = filters.get('score_max');
  const hasPhone = filters.get('has_phone');
  const hasEmail = filters.get('has_email');
  const createdAfter = filters.get('created_after');
  const createdBefore = filters.get('created_before');
  const lostReasonId = filters.get('lost_reason_id');

  const activeFilterCount = [
    statusFilter.length > 0, sourceFilter.length > 0, assignedTo, scoreMin, scoreMax,
    hasPhone, hasEmail, createdAfter, createdBefore, lostReasonId, tagFilterIds.length > 0,
  ].filter(Boolean).length;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { setSelectedIds([]); setLastSelectedIndex(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const queryClient = useQueryClient();
  const queryKeyObj = {
    search, status: statusFilter.join(','), source: sourceFilter.join(','),
    assigned_to: assignedTo, score_min: scoreMin, score_max: scoreMax,
    has_phone: hasPhone, has_email: hasEmail,
    created_after: createdAfter, created_before: createdBefore,
    lost_reason_id: lostReasonId, tags: tagFilterIds.join(','),
  };
  const { data, isLoading } = useQuery({
    queryKey: ['leads', queryKeyObj],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (statusFilter.length) params.set('status', statusFilter.join(','));
      if (sourceFilter.length) params.set('source', sourceFilter.join(','));
      if (assignedTo) params.set('assigned_to', assignedTo);
      if (scoreMin) params.set('score_min', scoreMin);
      if (scoreMax) params.set('score_max', scoreMax);
      if (hasPhone) params.set('has_phone', hasPhone);
      if (hasEmail) params.set('has_email', hasEmail);
      if (createdAfter) params.set('created_after', createdAfter);
      if (createdBefore) params.set('created_before', createdBefore);
      if (lostReasonId) params.set('lost_reason_id', lostReasonId);
      if (tagFilterIds.length) params.set('tags', tagFilterIds.join(','));
      const res = await fetch(`${API_URL}/leads?${params}`);
      if (!res.ok) throw new Error('Failed to fetch leads');
      return res.json();
    },
  });

  const { data: savedFiltersList = [] } = useQuery({
    queryKey: ['saved-filters'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/saved-filters`);
      return res.ok ? res.json() : [];
    },
  });

  const { data: lostReasons = [] } = useQuery({
    queryKey: ['lost-reasons'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/lost-reasons`);
      return res.ok ? res.json() : [];
    },
  });

  const saveFilterMutation = useMutation({
    mutationFn: async (body) => {
      const res = await fetch(`${API_URL}/saved-filters`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-filters'] });
      setShowSaveModal(false);
      setSaveForm({ name: '', is_default: false, is_shared: false });
    },
  });

  const deleteFilterMutation = useMutation({
    mutationFn: async (id) => {
      await fetch(`${API_URL}/saved-filters/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['saved-filters'] }),
  });

  const applySavedFilter = (sf) => {
    const f = sf.filters || {};
    const next = {};
    if (f.status) next.status = Array.isArray(f.status) ? f.status.join(',') : f.status;
    if (f.source) next.source = Array.isArray(f.source) ? f.source.join(',') : f.source;
    if (f.assigned_to) next.assigned_to = f.assigned_to;
    if (f.score_min) next.score_min = String(f.score_min);
    if (f.score_max) next.score_max = String(f.score_max);
    if (f.has_phone !== undefined) next.has_phone = String(f.has_phone);
    if (f.has_email !== undefined) next.has_email = String(f.has_email);
    if (f.created_after) next.created_after = f.created_after;
    if (f.created_before) next.created_before = f.created_before;
    if (f.tags) { setTagFilterIds(Array.isArray(f.tags) ? f.tags : []); }
    filters.applyAll(next);
    setShowSavedList(false);
  };

  const buildCurrentFilters = () => {
    const f = {};
    if (statusFilter.length) f.status = statusFilter;
    if (sourceFilter.length) f.source = sourceFilter;
    if (assignedTo) f.assigned_to = assignedTo;
    if (scoreMin) f.score_min = parseInt(scoreMin, 10);
    if (scoreMax) f.score_max = parseInt(scoreMax, 10);
    if (hasPhone) f.has_phone = hasPhone === 'true';
    if (hasEmail) f.has_email = hasEmail === 'true';
    if (createdAfter) f.created_after = createdAfter;
    if (createdBefore) f.created_before = createdBefore;
    if (tagFilterIds.length) f.tags = tagFilterIds;
    return f;
  };

  const toggleStatus = (s) => {
    const current = statusFilter;
    const next = current.includes(s) ? current.filter(x => x !== s) : [...current, s];
    filters.set('status', next);
  };

  const toggleSource = (s) => {
    const current = sourceFilter;
    const next = current.includes(s) ? current.filter(x => x !== s) : [...current, s];
    filters.set('source', next);
  };

  const { data: salespeople } = useQuery({
    queryKey: ['salespeople'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/salespeople`);
      if (!res.ok) return [];
      const d = await res.json();
      return Array.isArray(d) ? d : d.data || [];
    },
  });

  const salespeopleMap = {};
  (salespeople || []).forEach(s => { salespeopleMap[s.id] = s.name; });

  const { data: allTags = [] } = useQuery({
    queryKey: ['tags'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/tags`);
      if (!res.ok) return [];
      const json = await res.json();
      return json.data || [];
    },
  });

  const { data: leadTagsMap = {} } = useQuery({
    queryKey: ['lead-tags-map', (data?.data || []).map(l => l.id).join(',')],
    enabled: !!data?.data?.length,
    queryFn: async () => {
      const baseLeads = data?.data || [];
      const results = await Promise.all(
        baseLeads.map(async (lead) => {
          try {
            const res = await fetch(`${API_URL}/leads/${lead.id}/tags`);
            if (!res.ok) return [lead.id, []];
            const json = await res.json();
            return [lead.id, json.data || []];
          } catch {
            return [lead.id, []];
          }
        })
      );
      return Object.fromEntries(results);
    },
  });

  const { data: allTasks = [] } = useQuery({
    queryKey: ['all-follow-up-tasks'],
    queryFn: async () => {
      const leadsRes = await fetch(`${API_URL}/leads`);
      const leadsData = await leadsRes.json();
      const allLeadTasks = [];
      for (const lead of (leadsData.data || [])) {
        try {
          const taskRes = await fetch(`${API_URL}/leads/${lead.id}/tasks`);
          const tasks = await taskRes.json();
          allLeadTasks.push(...(Array.isArray(tasks) ? tasks : []).map(t => ({
            ...t,
            lead_name: `${lead.first_name || ''} ${lead.last_name || ''}`.trim(),
          })));
        } catch (e) {
          // skip leads with task fetch errors
        }
      }
      return allLeadTasks;
    },
    refetchInterval: 60000,
  });

  const getLeadFollowUp = (leadId) => {
    const leadTasks = allTasks.filter(t => t.lead_id === leadId && t.task_type === 'follow_up' && !t.completed);
    if (!leadTasks.length) return null;
    const sorted = [...leadTasks].sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
    const next = sorted[0];
    const now = new Date();
    const due = new Date(next.due_at);
    const isOverdue = due < now;
    const isToday = due.toDateString() === now.toDateString();
    return { ...next, isOverdue, isToday };
  };

  let leads = data?.data || [];
  const total = data?.total || 0;

  // Sort by AI score (highest first)
  leads = leads.sort((a, b) => calculateLeadScore(b).score - calculateLeadScore(a).score);

  const allSelected = leads.length > 0 && leads.every(l => selectedIds.includes(l.id));
  const someSelected = selectedIds.length > 0 && !allSelected;

  const handleToggleSelect = (leadId, index, shiftKey) => {
    if (shiftKey && lastSelectedIndex !== null) {
      const start = Math.min(lastSelectedIndex, index);
      const end = Math.max(lastSelectedIndex, index);
      const rangeIds = leads.slice(start, end + 1).map(l => l.id);
      setSelectedIds(prev => Array.from(new Set([...prev, ...rangeIds])));
    } else {
      setSelectedIds(prev =>
        prev.includes(leadId) ? prev.filter(id => id !== leadId) : [...prev, leadId]
      );
    }
    setLastSelectedIndex(index);
  };

  const handleToggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds([]);
      setLastSelectedIndex(null);
    } else {
      setSelectedIds(leads.map(l => l.id));
    }
  };

  const clearSelection = () => {
    setSelectedIds([]);
    setLastSelectedIndex(null);
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <UserPlus size={24} className="text-[var(--color-accent)]" />
          <h1 className="text-2xl font-bold text-[var(--color-text)]">{t('leads.title')}</h1>
          <span className="text-sm text-[var(--color-text-secondary)]">({total})</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-0.5">
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                viewMode === 'list'
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
              }`}
              aria-label="List view"
              title={t('leads.listView', { defaultValue: 'List view' })}
            >
              <List size={16} />
              <span className="hidden sm:inline">{t('leads.listView', { defaultValue: 'List' })}</span>
            </button>
            <button
              onClick={() => setViewMode('board')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                viewMode === 'board'
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
              }`}
              aria-label="Board view"
              title={t('leads.boardView', { defaultValue: 'Board view' })}
            >
              <LayoutGrid size={16} />
              <span className="hidden sm:inline">{t('leads.boardView', { defaultValue: 'Board' })}</span>
            </button>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-accent)] text-white hover:opacity-90"
          >
            <Plus size={18} />
            {t('leads.addLead')}
          </button>
        </div>
      </div>

      <FollowUpAlertBar allTasks={allTasks} />

      {/* Search bar */}
      <div className="flex gap-3 mb-3">
        {viewMode === 'list' && leads.length > 0 && (
          <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] cursor-pointer select-none">
            <input type="checkbox" checked={allSelected}
              ref={(el) => { if (el) el.indeterminate = someSelected; }}
              onChange={handleToggleSelectAll}
              className="w-4 h-4 rounded border-gray-300 text-blue-600" />
            <span className="text-xs text-[var(--color-text-secondary)] whitespace-nowrap">{t('bulk.selectAll')}</span>
          </label>
        )}
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]" />
          <input type="text" placeholder={t('leads.searchPlaceholder')} value={search}
            onChange={(e) => filters.set('search', e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]" />
        </div>
      </div>

      {/* Status chips */}
      <div className="flex flex-wrap gap-1.5 mb-2">
        {STATUSES.map(s => {
          const active = statusFilter.includes(s);
          return (
            <button key={s} onClick={() => toggleStatus(s)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                active ? 'text-white border-transparent' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
              }`}
              style={active ? { backgroundColor: STATUS_COLORS[s] || '#6B7280' } : undefined}>
              {t(`leads.status.${s}`, s.charAt(0).toUpperCase() + s.slice(1))}
            </button>
          );
        })}
      </div>

      {/* Source chips */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {SOURCES_LIST.map(s => {
          const active = sourceFilter.includes(s);
          const cfg = SOURCE_CONFIG[s];
          return (
            <button key={s} onClick={() => toggleSource(s)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
              }`}>
              {cfg?.icon || ''} {cfg?.label || s}
            </button>
          );
        })}
      </div>

      {/* Filter actions bar */}
      <div className="flex items-center gap-2 mb-3">
        <button onClick={() => setShowMoreFilters(p => !p)}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-50">
          <Filter size={12} /> {t('filters.moreFilters')}
          {showMoreFilters ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>

        {activeFilterCount > 0 && (
          <span className="text-xs text-gray-500">
            {t('filters.filterCount', { count: activeFilterCount })}
          </span>
        )}

        {activeFilterCount > 0 && (
          <button onClick={() => { filters.clear(); setTagFilterIds([]); }}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-red-600 hover:bg-red-50">
            <X size={12} /> {t('filters.clearAll')}
          </button>
        )}

        <div className="ml-auto flex gap-2">
          {/* Save filter */}
          <button onClick={() => setShowSaveModal(true)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-50">
            <Save size={12} /> {t('filters.saveFilter')}
          </button>

          {/* Saved filters dropdown */}
          <div className="relative">
            <button onClick={() => setShowSavedList(p => !p)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-50">
              <Bookmark size={12} /> {t('filters.savedFilters')}
              {savedFiltersList.length > 0 && <span className="text-gray-400">({savedFiltersList.length})</span>}
            </button>
            {showSavedList && (
              <div className="absolute right-0 top-full mt-1 z-40 w-64 bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden">
                <div className="max-h-56 overflow-y-auto">
                  {savedFiltersList.length === 0 ? (
                    <p className="text-xs text-gray-400 py-4 text-center">{t('filters.noSavedFilters')}</p>
                  ) : savedFiltersList.map(sf => (
                    <div key={sf.id} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50">
                      <button onClick={() => applySavedFilter(sf)} className="flex-1 text-left text-sm text-gray-700 truncate flex items-center gap-1">
                        {sf.is_default && <Star size={10} className="text-amber-500 shrink-0" />}
                        {sf.name}
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); deleteFilterMutation.mutate(sf.id); }}
                        className="text-gray-300 hover:text-red-500 shrink-0"><X size={12} /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* More Filters panel */}
      {showMoreFilters && (
        <div className="mb-4 p-4 bg-white rounded-xl border border-gray-200 shadow-sm grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-[10px] font-medium text-gray-500 uppercase mb-1">{t('filters.assignedTo')}</label>
            <select value={assignedTo} onChange={e => filters.set('assigned_to', e.target.value)}
              className="w-full px-2 py-1.5 rounded-lg border border-gray-200 text-sm">
              <option value="">All</option>
              {(salespeople || []).map(sp => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-medium text-gray-500 uppercase mb-1">{t('filters.scoreRange')}</label>
            <div className="flex gap-1">
              <input type="number" min="0" max="100" value={scoreMin} placeholder={t('filters.scoreMin')}
                onChange={e => filters.set('score_min', e.target.value)}
                className="w-1/2 px-2 py-1.5 rounded-lg border border-gray-200 text-sm" />
              <input type="number" min="0" max="100" value={scoreMax} placeholder={t('filters.scoreMax')}
                onChange={e => filters.set('score_max', e.target.value)}
                className="w-1/2 px-2 py-1.5 rounded-lg border border-gray-200 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-medium text-gray-500 uppercase mb-1">{t('filters.dateRange')}</label>
            <div className="flex gap-1">
              <input type="date" value={createdAfter} onChange={e => filters.set('created_after', e.target.value)}
                className="w-1/2 px-2 py-1.5 rounded-lg border border-gray-200 text-sm" />
              <input type="date" value={createdBefore} onChange={e => filters.set('created_before', e.target.value)}
                className="w-1/2 px-2 py-1.5 rounded-lg border border-gray-200 text-sm" />
            </div>
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={hasPhone === 'true'}
                onChange={e => filters.set('has_phone', e.target.checked ? 'true' : '')}
                className="rounded border-gray-300" />
              {t('filters.hasPhone')}
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={hasEmail === 'true'}
                onChange={e => filters.set('has_email', e.target.checked ? 'true' : '')}
                className="rounded border-gray-300" />
              {t('filters.hasEmail')}
            </label>
          </div>
          {statusFilter.includes('lost') && (
            <div>
              <label className="block text-[10px] font-medium text-gray-500 uppercase mb-1">{t('filters.lostReason')}</label>
              <select value={lostReasonId} onChange={e => filters.set('lost_reason_id', e.target.value)}
                className="w-full px-2 py-1.5 rounded-lg border border-gray-200 text-sm">
                <option value="">All Reasons</option>
                {lostReasons.map(r => <option key={r.id} value={r.id}>{r.icon} {r.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-[10px] font-medium text-gray-500 uppercase mb-1">{t('filters.tags')}</label>
            <div className="flex flex-wrap gap-1 p-1.5 rounded-lg border border-gray-200 bg-white max-h-20 overflow-y-auto">
              {allTags.map(tag => {
                const checked = tagFilterIds.includes(tag.id);
                return (
                  <button key={tag.id} onClick={() => setTagFilterIds(prev => prev.includes(tag.id) ? prev.filter(id => id !== tag.id) : [...prev, tag.id])}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                      checked ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-200 text-gray-500'
                    }`}>
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tag.color }} />
                    {tag.name}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Save Filter Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5">
            <h3 className="text-base font-bold text-gray-900 mb-4">{t('filters.saveFilter')}</h3>
            <div className="space-y-3">
              <input type="text" value={saveForm.name} onChange={e => setSaveForm(f => ({ ...f, name: e.target.value }))}
                placeholder={t('filters.saveName')} className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={saveForm.is_default}
                  onChange={e => setSaveForm(f => ({ ...f, is_default: e.target.checked }))}
                  className="rounded border-gray-300" />
                <Star size={12} className={saveForm.is_default ? 'text-amber-500' : 'text-gray-400'} />
                {t('filters.setDefault')}
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={saveForm.is_shared}
                  onChange={e => setSaveForm(f => ({ ...f, is_shared: e.target.checked }))}
                  className="rounded border-gray-300" />
                {t('filters.shareWithTeam')}
              </label>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowSaveModal(false)}
                className="flex-1 px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600">{t('filters.cancel')}</button>
              <button disabled={!saveForm.name} onClick={() => saveFilterMutation.mutate({ ...saveForm, filters: buildCurrentFilters() })}
                className="flex-1 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium disabled:opacity-50">{t('filters.save')}</button>
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12 text-[var(--color-text-secondary)]">{t('contacts.loading')}</div>
      ) : leads.length === 0 ? (
        <div className="text-center py-12 text-[var(--color-text-secondary)]">{t('leads.noLeads')}</div>
      ) : viewMode === 'board' ? (
        <LeadKanbanBoard
          leads={leads}
          salespeopleMap={salespeopleMap}
          onStatusChange={(leadId, newStatus) => {
            queryClient.setQueryData(['leads', queryKeyObj], (old) => {
              if (!old?.data) return old;
              return {
                ...old,
                data: old.data.map(l => l.id === leadId ? { ...l, status: newStatus } : l),
              };
            });
            queryClient.invalidateQueries({ queryKey: ['leads'] });
          }}
          getLeadFollowUp={getLeadFollowUp}
          onScheduleFollowUp={(leadId, leadName) => setFollowUpModal({ open: true, leadId, leadName })}
          leadTagsMap={leadTagsMap}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {leads.map((lead, idx) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              index={idx}
              onClick={() => navigate(`/leads/${lead.id}`)}
              salespeopleMap={salespeopleMap}
              followUp={getLeadFollowUp(lead.id)}
              onScheduleFollowUp={() => setFollowUpModal({
                open: true,
                leadId: lead.id,
                leadName: `${lead.first_name || ''} ${lead.last_name || ''}`.trim(),
                leadIds: null,
              })}
              selected={selectedIds.includes(lead.id)}
              onToggleSelect={handleToggleSelect}
              tags={leadTagsMap[lead.id] || []}
            />
          ))}
        </div>
      )}

      <AddLeadModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onCreated={() => {}}
      />

      {followUpModal.open && (
        <QuickFollowUpModal
          leadId={followUpModal.leadId}
          leadIds={followUpModal.leadIds}
          leadName={followUpModal.leadName}
          isOpen={followUpModal.open}
          onClose={() => setFollowUpModal({ open: false, leadId: null, leadName: '', leadIds: null })}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['all-follow-up-tasks'] });
            if (followUpModal.leadIds) clearSelection();
          }}
        />
      )}

      <BulkActionBar
        selectedIds={selectedIds}
        leads={leads}
        onClearSelection={clearSelection}
        onBulkScheduleFollowUp={(ids) => setFollowUpModal({
          open: true,
          leadId: null,
          leadName: '',
          leadIds: ids,
        })}
        onBulkTagsApplied={() => {
          queryClient.invalidateQueries({ queryKey: ['lead-tags-map'] });
        }}
      />
    </div>
  );
}
