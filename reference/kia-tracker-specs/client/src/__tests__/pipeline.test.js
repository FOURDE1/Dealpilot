import { describe, it, expect } from 'vitest';
import {
  PIPELINE_STAGES, KANBAN_STAGES, FUNDING_STATUSES, LOST_REASONS,
  getStageColor, getFundingColor, getDaysInStage, getAgingColor, canComplete,
} from '../lib/pipeline';

describe('Pipeline utilities', () => {
  it('has 10 pipeline stages', () => {
    expect(PIPELINE_STAGES).toHaveLength(10);
  });

  it('kanban stages exclude complete and lost', () => {
    expect(KANBAN_STAGES).toHaveLength(8);
    expect(KANBAN_STAGES.find(s => s.id === 'complete')).toBeUndefined();
    expect(KANBAN_STAGES.find(s => s.id === 'lost')).toBeUndefined();
  });

  it('has 4 funding statuses', () => {
    expect(FUNDING_STATUSES).toHaveLength(4);
  });

  it('has 9 lost reasons', () => {
    expect(LOST_REASONS).toHaveLength(9);
  });

  it('getStageColor returns correct color for known stage', () => {
    expect(getStageColor('new')).toBe('#3B82F6');
    expect(getStageColor('lost')).toBe('#EF4444');
  });

  it('getStageColor returns gray for unknown stage', () => {
    expect(getStageColor('unknown')).toBe('#6B7280');
  });

  it('getFundingColor returns correct colors', () => {
    expect(getFundingColor('funded')).toBe('#22C55E');
    expect(getFundingColor('not_submitted')).toBe('#9CA3AF');
  });

  it('getDaysInStage calculates correctly', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString();
    expect(getDaysInStage(twoDaysAgo)).toBe(2);
    expect(getDaysInStage(null)).toBe(0);
  });

  it('getAgingColor returns correct colors', () => {
    expect(getAgingColor(0)).toBe('#22C55E'); // green
    expect(getAgingColor(2)).toBe('#22C55E'); // green
    expect(getAgingColor(5)).toBe('#F59E0B'); // amber
    expect(getAgingColor(10)).toBe('#EF4444'); // red
  });

  it('canComplete requires both delivered_at and funded status', () => {
    expect(canComplete({ delivered_at: null, funding_status: 'funded' })).toBeFalsy();
    expect(canComplete({ delivered_at: '2026-01-01', funding_status: 'submitted' })).toBeFalsy();
    expect(canComplete({ delivered_at: '2026-01-01', funding_status: 'funded' })).toBeTruthy();
  });
});
