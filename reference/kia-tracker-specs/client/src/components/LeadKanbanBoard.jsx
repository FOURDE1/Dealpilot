import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Phone, Clock, User, TrendingUp, TrendingDown, Flame, BellRing, CalendarPlus, AlertTriangle } from 'lucide-react';
import SpeedToLeadTimer from './SpeedToLeadTimer';
import TagBadge from './TagBadge';

const API_URL = import.meta.env.VITE_API_URL;

const STATUS_COLORS = {
  new: '#3B82F6',
  assigned: '#F59E0B',
  contacted: '#06B6D4',
  qualified: '#10B981',
  nurture: '#F97316',
  unresponsive: '#EF4444',
  lost: '#EF4444',
};

const COLUMNS = [
  { id: 'new', titleKey: 'leads.status.new', fallback: 'New' },
  { id: 'assigned', titleKey: 'leads.status.assigned', fallback: 'Assigned' },
  { id: 'contacted', titleKey: 'leads.status.contacted', fallback: 'Contacted' },
  { id: 'qualified', titleKey: 'leads.status.qualified', fallback: 'Qualified' },
  { id: 'nurture', titleKey: 'leads.status.nurture', fallback: 'Nurture' },
  { id: 'unresponsive', titleKey: 'leads.status.unresponsive', fallback: 'Unresponsive' },
  { id: 'lost', titleKey: 'leads.status.lost', fallback: 'Lost' },
];

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
  manual:         { icon: '\u{270F}\u{FE0F}', label: 'Manual', color: '#6B7280', bg: '#F3F4F6' },
  other:          { icon: '\u{1F4CC}', label: 'Other',         color: '#6B7280', bg: '#F3F4F6' },
};

function getSourceInfo(source) {
  return SOURCE_CONFIG[source] || SOURCE_CONFIG.other;
}

function calculateLeadScore(lead) {
  let score = 0;
  const sourceScores = { website: 25, referral: 22, walk_in: 20, phone: 18, service: 15, manual: 5, other: 10 };
  score += sourceScores[lead.source] || 10;
  if (lead.phone) score += 8;
  if (lead.email) score += 7;
  if (lead.vehicle_interest) score += 5;
  const daysOld = Math.floor((Date.now() - new Date(lead.created_at)) / 86400000);
  score += daysOld <= 1 ? 25 : daysOld <= 3 ? 20 : daysOld <= 7 ? 15 : daysOld <= 14 ? 10 : daysOld <= 30 ? 5 : 0;
  const statusScores = { new: 20, contacted: 15, qualified: 18, negotiation: 12, won: 10, lost: 0 };
  score += statusScores[lead.status] || 5;
  if (lead.assigned_to) score += 10;
  return Math.min(score, 100);
}

function getScoreColor(score) {
  if (score >= 80) return { bg: '#DCFCE7', text: '#16A34A', ring: '#22C55E' };
  if (score >= 60) return { bg: '#FEF9C3', text: '#CA8A04', ring: '#EAB308' };
  if (score >= 40) return { bg: '#FED7AA', text: '#EA580C', ring: '#F97316' };
  return { bg: '#FEE2E2', text: '#DC2626', ring: '#EF4444' };
}

function getScoreTrendIcon(lead) {
  const daysOld = Math.floor((Date.now() - new Date(lead.created_at)) / 86400000);
  if (daysOld <= 3) return 'up';
  if (daysOld <= 7) return 'flat';
  return 'down';
}

function ScoreRing({ score }) {
  const colors = getScoreColor(score);
  const circumference = 2 * Math.PI * 16;
  const offset = circumference - (score / 100) * circumference;
  const trend = getScoreTrendIcon({ created_at: new Date().toISOString() });

  return (
    <div className="relative flex items-center justify-center" style={{ width: 40, height: 40 }}>
      <svg width="40" height="40" className="-rotate-90">
        <circle cx="20" cy="20" r="16" stroke="#E5E7EB" strokeWidth="3" fill="none" />
        <circle
          cx="20"
          cy="20"
          r="16"
          stroke={colors.ring}
          strokeWidth="3"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div
        className="absolute inset-0 flex items-center justify-center text-[10px] font-bold"
        style={{ color: colors.text }}
      >
        {score}
      </div>
    </div>
  );
}

function SourceBadge({ source }) {
  const info = getSourceInfo(source);
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full font-medium text-[10px] px-1.5 py-0.5"
      style={{ backgroundColor: info.bg, color: info.color }}
    >
      <span className="text-[10px]">{info.icon}</span>
      {info.label}
    </span>
  );
}

function KanbanCard({ lead, salespeopleMap, index, onClick, getLeadFollowUp, onScheduleFollowUp, tags }) {
  const { t } = useTranslation();
  const score = calculateLeadScore(lead);
  const fullName = `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || t('leads.unknown');
  const trend = getScoreTrendIcon(lead);
  const followUp = getLeadFollowUp?.(lead.id) || null;
  const accentClass = followUp?.isOverdue
    ? 'border-l-4 border-l-red-400 bg-red-50/30'
    : followUp?.isToday
    ? 'border-l-4 border-l-amber-400 bg-amber-50/30'
    : '';

  return (
    <Draggable draggableId={String(lead.id)} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={onClick}
          className={`bg-white border border-gray-200 rounded-xl p-3 mb-2 cursor-pointer transition-shadow ${accentClass} ${
            snapshot.isDragging ? 'shadow-lg rotate-1' : 'shadow-sm hover:shadow-md'
          }`}
          style={provided.draggableProps.style}
        >
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-gray-900 truncate">{fullName}</div>
              {lead.vehicle_interest && (
                <div className="text-xs text-gray-500 truncate mt-0.5">{lead.vehicle_interest}</div>
              )}
            </div>
            <div className="flex items-center gap-1">
              {trend === 'up' && <TrendingUp size={10} className="text-green-600" />}
              {trend === 'down' && <TrendingDown size={10} className="text-red-600" />}
              {score >= 80 && <Flame size={10} className="text-orange-500" />}
              <ScoreRing score={score} />
            </div>
          </div>

          {lead.source && (
            <div className="mb-2">
              <SourceBadge source={lead.source} />
            </div>
          )}

          {lead.assigned_to && salespeopleMap?.[lead.assigned_to] && (
            <div className="mb-2">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[10px] font-medium">
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

          <div className="flex items-center justify-between text-[11px] text-gray-500 pt-1 border-t border-gray-100">
            {lead.phone ? (
              <span className="flex items-center gap-1 truncate">
                <Phone size={10} />
                {lead.phone}
              </span>
            ) : <span />}
            <span className="flex-shrink-0 ml-2">
              <SpeedToLeadTimer lead={lead} size="md" />
            </span>
          </div>

          {followUp ? (
            <div className={`mt-2 pt-2 border-t text-xs flex items-center gap-1 ${
              followUp.isOverdue ? 'text-red-600 border-red-100 font-semibold' :
              followUp.isToday ? 'text-amber-600 border-amber-100' : 'text-blue-600 border-blue-100'
            }`}>
              {followUp.isOverdue ? <BellRing className="w-3 h-3 animate-pulse" /> :
               followUp.isToday ? <Clock className="w-3 h-3" /> : <CalendarPlus className="w-3 h-3" />}
              <span>{new Date(followUp.due_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
            </div>
          ) : ['new', 'assigned', 'contacted', 'qualified'].includes(lead.status) ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onScheduleFollowUp?.(lead.id, `${lead.first_name || ''} ${lead.last_name || ''}`.trim());
              }}
              className="mt-2 pt-2 border-t border-gray-100 text-xs text-amber-500 hover:text-amber-700 flex items-center gap-1 w-full"
            >
              <AlertTriangle className="w-3 h-3" />
              <span>{t('followUp.card.noFollowUp')}</span>
              <CalendarPlus className="w-3 h-3 ml-auto" />
            </button>
          ) : null}
        </div>
      )}
    </Draggable>
  );
}

function KanbanColumn({ column, leads, salespeopleMap, onCardClick, getLeadFollowUp, onScheduleFollowUp, leadTagsMap }) {
  const { t } = useTranslation();
  const color = STATUS_COLORS[column.id];
  const title = t(column.titleKey, { defaultValue: column.fallback });

  return (
    <div className="flex flex-col bg-gray-50 rounded-xl border border-gray-200 w-72 flex-shrink-0">
      <div
        className="flex items-center justify-between px-3 py-2 rounded-t-xl border-b border-gray-200"
        style={{ backgroundColor: `${color}15`, borderTopColor: color, borderTopWidth: 3 }}
      >
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-sm font-semibold" style={{ color }}>{title}</span>
        </div>
        <span
          className="text-xs font-bold px-2 py-0.5 rounded-full text-white"
          style={{ backgroundColor: color }}
        >
          {leads.length}
        </span>
      </div>

      <Droppable droppableId={column.id}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`flex-1 p-2 min-h-[200px] overflow-y-auto transition-colors ${
              snapshot.isDraggingOver ? 'bg-blue-50' : ''
            }`}
            style={{ maxHeight: 'calc(100vh - 280px)' }}
          >
            {leads.map((lead, index) => (
              <KanbanCard
                key={lead.id}
                lead={lead}
                index={index}
                salespeopleMap={salespeopleMap}
                onCardClick={onCardClick}
                onClick={() => onCardClick?.(lead)}
                getLeadFollowUp={getLeadFollowUp}
                onScheduleFollowUp={onScheduleFollowUp}
                tags={leadTagsMap?.[lead.id] || []}
              />
            ))}
            {provided.placeholder}
            {leads.length === 0 && !snapshot.isDraggingOver && (
              <div className="text-center text-xs text-gray-400 py-6">—</div>
            )}
          </div>
        )}
      </Droppable>
    </div>
  );
}

export default function LeadKanbanBoard({ leads, salespeopleMap, onStatusChange, getLeadFollowUp, onScheduleFollowUp, leadTagsMap }) {
  const navigate = useNavigate();

  const columnLeads = useMemo(() => {
    const grouped = {};
    COLUMNS.forEach(c => { grouped[c.id] = []; });
    (leads || []).forEach(lead => {
      const status = grouped[lead.status] ? lead.status : null;
      if (status) grouped[status].push(lead);
    });
    return grouped;
  }, [leads]);

  const handleDragEnd = async (result) => {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;

    const newStatus = destination.droppableId;
    const leadId = draggableId;

    onStatusChange?.(leadId, newStatus);

    try {
      const res = await fetch(`${API_URL}/leads/${leadId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error('Failed to update lead status');
    } catch (err) {
      console.error('Lead status update failed:', err);
      onStatusChange?.(leadId, source.droppableId);
    }
  };

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-4">
        {COLUMNS.map(column => (
          <KanbanColumn
            key={column.id}
            column={column}
            leads={columnLeads[column.id] || []}
            salespeopleMap={salespeopleMap}
            onCardClick={(lead) => navigate(`/leads/${lead.id}`)}
            getLeadFollowUp={getLeadFollowUp}
            onScheduleFollowUp={onScheduleFollowUp}
            leadTagsMap={leadTagsMap}
          />
        ))}
      </div>
    </DragDropContext>
  );
}
