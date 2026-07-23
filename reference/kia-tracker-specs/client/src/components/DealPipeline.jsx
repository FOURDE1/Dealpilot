import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { LayoutGrid, List, Plus, Clock } from 'lucide-react';
import {
  KANBAN_STAGES, LOST_REASONS,
  getStageColor, getFundingColor, getDaysInStage, getAgingColor, canComplete,
} from '../lib/pipeline';
import { formatCurrency } from '../lib/currency';

const API_URL = import.meta.env.VITE_API_URL;

function DealCard({ deal, index }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const days = getDaysInStage(deal.stage_entered_at);
  const agingColor = getAgingColor(days);
  const fundingColor = getFundingColor(deal.funding_status);
  const vehicle = [deal.year, deal.make, deal.model].filter(Boolean).join(' ') || t('pipeline.noVehicle');

  return (
    <Draggable draggableId={deal.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={() => navigate(`/deal/${deal.id}`)}
          className={`bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-3 mb-2 cursor-pointer transition-shadow ${
            snapshot.isDragging ? 'shadow-lg ring-2 ring-[var(--color-accent)]' : 'hover:shadow-md'
          }`}
        >
          <div className="text-sm font-medium text-[var(--color-text)] truncate">
            {deal.customer_name || t('pipeline.noCustomer')}
          </div>
          <div className="text-xs text-[var(--color-text-secondary)] mt-0.5 truncate">
            {vehicle}
          </div>
          {deal.sale_price > 0 && (
            <div className="text-sm font-semibold text-[var(--color-text)] mt-1">
              {formatCurrency(deal.sale_price)}
            </div>
          )}
          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center gap-1.5">
              {deal.salesperson_name && (
                <span className="w-6 h-6 rounded-full bg-[var(--color-accent)]/20 text-[var(--color-accent)] text-xs flex items-center justify-center font-medium">
                  {deal.salesperson_name.charAt(0).toUpperCase()}
                </span>
              )}
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full text-white font-medium"
                style={{ backgroundColor: fundingColor }}
              >
                {t(`pipeline.funding.${deal.funding_status || 'not_submitted'}`).split('.').pop()}
              </span>
            </div>
            <div className="flex items-center gap-1 text-xs" style={{ color: agingColor }}>
              <Clock size={12} />
              <span>{days}d</span>
            </div>
          </div>
        </div>
      )}
    </Draggable>
  );
}

function KanbanColumn({ stage, deals }) {
  const { t } = useTranslation();
  const stageDeals = deals.filter((d) => d.pipeline_stage === stage.id);
  const totalValue = stageDeals.reduce((sum, d) => sum + (d.sale_price || 0), 0);

  return (
    <div className="flex-shrink-0 w-[280px]">
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
          <span className="text-sm font-semibold text-[var(--color-text)]">{t(stage.label)}</span>
          <span className="text-xs text-[var(--color-text-secondary)] bg-[var(--color-bg)] px-1.5 py-0.5 rounded-full">
            {stageDeals.length}
          </span>
        </div>
        {totalValue > 0 && (
          <span className="text-xs text-[var(--color-text-secondary)]">
            {formatCurrency(totalValue, { showCents: false })}
          </span>
        )}
      </div>

      <Droppable droppableId={stage.id}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`min-h-[200px] rounded-lg p-1 transition-colors ${
              snapshot.isDraggingOver ? 'bg-[var(--color-accent)]/5' : 'bg-[var(--color-bg)]/50'
            }`}
          >
            {stageDeals.map((deal, index) => (
              <DealCard key={deal.id} deal={deal} index={index} />
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  );
}

function LostReasonModal({ isOpen, onClose, onConfirm }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState('');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--color-card)] rounded-xl shadow-xl w-full max-w-md p-6">
        <h3 className="text-lg font-semibold text-[var(--color-text)] mb-4">{t('pipeline.lostReasonTitle')}</h3>
        <div className="space-y-2 mb-4">
          {LOST_REASONS.map((r) => (
            <label key={r.id} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="lostReason"
                value={r.id}
                checked={reason === r.id}
                onChange={(e) => setReason(e.target.value)}
                className="text-[var(--color-accent)]"
              />
              <span className="text-sm text-[var(--color-text)]">{t(r.label)}</span>
            </label>
          ))}
        </div>
        {reason === 'other' && (
          <textarea
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            placeholder={t('pipeline.lostReasonDetail')}
            className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm mb-4"
            rows={2}
          />
        )}
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-[var(--color-border)] text-[var(--color-text)]">
            {t('contacts.cancel')}
          </button>
          <button
            onClick={() => { if (reason) onConfirm(reason, detail); }}
            disabled={!reason}
            className="flex-1 px-4 py-2 rounded-lg bg-red-500 text-white disabled:opacity-50"
          >
            {t('pipeline.markLost')}
          </button>
        </div>
      </div>
    </div>
  );
}

function ListView({ deals }) {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)]">
            <th className="text-left py-2 px-3 text-[var(--color-text-secondary)] font-medium">{t('pipeline.customer')}</th>
            <th className="text-left py-2 px-3 text-[var(--color-text-secondary)] font-medium">{t('pipeline.vehicle')}</th>
            <th className="text-left py-2 px-3 text-[var(--color-text-secondary)] font-medium">{t('pipeline.stage')}</th>
            <th className="text-left py-2 px-3 text-[var(--color-text-secondary)] font-medium">{t('pipeline.salesperson')}</th>
            <th className="text-right py-2 px-3 text-[var(--color-text-secondary)] font-medium">{t('pipeline.value')}</th>
            <th className="text-center py-2 px-3 text-[var(--color-text-secondary)] font-medium">{t('pipeline.funding')}</th>
            <th className="text-center py-2 px-3 text-[var(--color-text-secondary)] font-medium">{t('pipeline.daysInStage')}</th>
          </tr>
        </thead>
        <tbody>
          {deals.map((deal) => {
            const days = getDaysInStage(deal.stage_entered_at);
            return (
              <tr
                key={deal.id}
                onClick={() => navigate(`/deal/${deal.id}`)}
                className="border-b border-[var(--color-border)] hover:bg-[var(--color-bg)] cursor-pointer"
              >
                <td className="py-2 px-3 text-[var(--color-text)]">{deal.customer_name || '-'}</td>
                <td className="py-2 px-3 text-[var(--color-text-secondary)]">
                  {[deal.year, deal.make, deal.model].filter(Boolean).join(' ') || '-'}
                </td>
                <td className="py-2 px-3">
                  <span
                    className="text-xs px-2 py-0.5 rounded-full text-white"
                    style={{ backgroundColor: getStageColor(deal.pipeline_stage) }}
                  >
                    {t(`pipeline.${deal.pipeline_stage}`)}
                  </span>
                </td>
                <td className="py-2 px-3 text-[var(--color-text-secondary)]">{deal.salesperson_name || '-'}</td>
                <td className="py-2 px-3 text-right font-medium text-[var(--color-text)]">
                  {deal.sale_price ? formatCurrency(deal.sale_price) : '-'}
                </td>
                <td className="py-2 px-3 text-center">
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full text-white"
                    style={{ backgroundColor: getFundingColor(deal.funding_status) }}
                  >
                    {deal.funding_status?.replace('_', ' ')}
                  </span>
                </td>
                <td className="py-2 px-3 text-center" style={{ color: getAgingColor(days) }}>
                  {days}d
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function DealPipeline() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [view, setView] = useState('kanban');
  const [showLostModal, setShowLostModal] = useState(false);
  const [pendingLostDealId, setPendingLostDealId] = useState(null);

  const { data: deals = [], isLoading } = useQuery({
    queryKey: ['deals-pipeline'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/deals`);
      if (!res.ok) throw new Error('Failed to fetch deals');
      const data = await res.json();
      return Array.isArray(data) ? data : data.data || [];
    },
  });

  const stageChangeMutation = useMutation({
    mutationFn: async ({ dealId, newStage, lostReason, lostReasonDetail }) => {
      const body = { pipeline_stage: newStage, stage_entered_at: new Date().toISOString() };
      if (newStage === 'lost') {
        body.lost_reason = lostReason;
        body.lost_reason_detail = lostReasonDetail;
        body.lost_at = new Date().toISOString();
      }
      const res = await fetch(`${API_URL}/deals/${dealId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed to update stage');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deals-pipeline'] });
    },
  });

  const handleDragEnd = useCallback((result) => {
    if (!result.destination) return;
    const { draggableId, destination } = result;
    const newStage = destination.droppableId;
    const deal = deals.find((d) => d.id === draggableId);
    if (!deal || deal.pipeline_stage === newStage) return;

    // Block move to complete if conditions not met
    if (newStage === 'complete' && !canComplete(deal)) {
      return; // silently block
    }

    // Lost requires reason
    if (newStage === 'lost') {
      setPendingLostDealId(draggableId);
      setShowLostModal(true);
      return;
    }

    stageChangeMutation.mutate({ dealId: draggableId, newStage });
  }, [deals, stageChangeMutation]);

  const handleLostConfirm = (reason, detail) => {
    if (pendingLostDealId) {
      stageChangeMutation.mutate({
        dealId: pendingLostDealId,
        newStage: 'lost',
        lostReason: reason,
        lostReasonDetail: detail,
      });
    }
    setShowLostModal(false);
    setPendingLostDealId(null);
  };

  // Filter out deleted deals
  const activeDeals = deals.filter((d) => !d.deleted_at);

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">{t('pipeline.title')}</h1>
        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div className="flex rounded-lg border border-[var(--color-border)] overflow-hidden">
            <button
              onClick={() => setView('kanban')}
              className={`p-2 ${view === 'kanban' ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-text-secondary)]'}`}
            >
              <LayoutGrid size={16} />
            </button>
            <button
              onClick={() => setView('list')}
              className={`p-2 ${view === 'list' ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-text-secondary)]'}`}
            >
              <List size={16} />
            </button>
          </div>
          <button
            onClick={() => navigate('/deal/new')}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-accent)] text-white hover:opacity-90"
          >
            <Plus size={18} />
            {t('pipeline.newDeal')}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-[var(--color-text-secondary)]">{t('contacts.loading')}</div>
      ) : view === 'kanban' ? (
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="flex gap-3 overflow-x-auto pb-4">
            {KANBAN_STAGES.map((stage) => (
              <KanbanColumn key={stage.id} stage={stage} deals={activeDeals} />
            ))}
          </div>
        </DragDropContext>
      ) : (
        <ListView deals={activeDeals} />
      )}

      <LostReasonModal
        isOpen={showLostModal}
        onClose={() => { setShowLostModal(false); setPendingLostDealId(null); }}
        onConfirm={handleLostConfirm}
      />
    </div>
  );
}
