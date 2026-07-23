/**
 * Pipeline stage definitions for the Kia Deal Tracker.
 * Source of truth for stage order, colors, and labels.
 */

export const PIPELINE_STAGES = [
  { id: 'new', label: 'pipeline.new', color: '#3B82F6', order: 1 },
  { id: 'submitted', label: 'pipeline.submitted', color: '#6366F1', order: 2 },
  { id: 'approved', label: 'pipeline.approved', color: '#06B6D4', order: 3 },
  { id: 'signed', label: 'pipeline.signed', color: '#F59E0B', order: 4 },
  { id: 'sourcing', label: 'pipeline.sourcing', color: '#8B5CF6', order: 5 },
  { id: 'pending_delivery', label: 'pipeline.pendingDelivery', color: '#14B8A6', order: 6 },
  { id: 'scheduled', label: 'pipeline.scheduled', color: '#10B981', order: 7 },
  { id: 'delivered', label: 'pipeline.delivered', color: '#22C55E', order: 8 },
  { id: 'complete', label: 'pipeline.complete', color: '#6B7280', order: 9 },
  { id: 'lost', label: 'pipeline.lost', color: '#EF4444', order: 10 },
];

export const FUNDING_STATUSES = [
  { id: 'not_submitted', label: 'pipeline.funding.notSubmitted', color: '#9CA3AF' },
  { id: 'submitted', label: 'pipeline.funding.submitted', color: '#F59E0B' },
  { id: 'stips_required', label: 'pipeline.funding.stipsRequired', color: '#F97316' },
  { id: 'funded', label: 'pipeline.funding.funded', color: '#22C55E' },
];

export const LOST_REASONS = [
  { id: 'not_approved', label: 'pipeline.lost.notApproved' },
  { id: 'changed_mind', label: 'pipeline.lost.changedMind' },
  { id: 'went_elsewhere', label: 'pipeline.lost.wentElsewhere' },
  { id: 'ghosted', label: 'pipeline.lost.ghosted' },
  { id: 'vehicle_unavailable', label: 'pipeline.lost.vehicleUnavailable' },
  { id: 'payment_too_high', label: 'pipeline.lost.paymentTooHigh' },
  { id: 'trade_disagreement', label: 'pipeline.lost.tradeDisagreement' },
  { id: 'idv_failed', label: 'pipeline.lost.idvFailed' },
  { id: 'other', label: 'pipeline.lost.other' },
];

export const KANBAN_STAGES = PIPELINE_STAGES.filter(
  (s) => !['complete', 'lost'].includes(s.id)
);

export function getStageColor(stageId) {
  return PIPELINE_STAGES.find((s) => s.id === stageId)?.color || '#6B7280';
}

export function getFundingColor(status) {
  return FUNDING_STATUSES.find((s) => s.id === status)?.color || '#9CA3AF';
}

export function getDaysInStage(stageEnteredAt) {
  if (!stageEnteredAt) return 0;
  const entered = new Date(stageEnteredAt);
  const now = new Date();
  return Math.floor((now - entered) / 86400000);
}

export function getAgingColor(days) {
  if (days < 3) return '#22C55E'; // green
  if (days <= 7) return '#F59E0B'; // amber
  return '#EF4444'; // red — deal is rotting
}

/**
 * Check if a deal can move to 'complete'.
 * Requires both delivery confirmed AND funding confirmed.
 */
export function canComplete(deal) {
  return deal.delivered_at && deal.funding_status === 'funded';
}
