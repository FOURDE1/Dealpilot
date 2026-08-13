import { describe, expect, it } from 'vitest';
import {
  AI_FIRST_TOUCH_SLO_SECONDS, SLA_TARGET_SECONDS, leadAgeBand, rateResponse, slaFraction, summarise,
} from './speed-to-lead.js';

/**
 * The bands ARE the claim (leads.md §5.1).
 *
 * "21× more likely to qualify inside five minutes" is the sentence this product
 * is sold on, so the boundary cases below are not pedantry — a dashboard that
 * calls 300 seconds excellent is a dashboard that reports the promise as kept
 * on the day it was missed.
 */

describe('rating a response time', () => {
  it('uses §5.1’s bands', () => {
    expect(rateResponse(0)).toBe('excellent');
    expect(rateResponse(299)).toBe('excellent');
    expect(rateResponse(899)).toBe('good');
    expect(rateResponse(1799)).toBe('fair');
    expect(rateResponse(1800)).toBe('slow');
    expect(rateResponse(86_400)).toBe('slow');
  });

  it('is strictly under, never “or equal”', () => {
    // Five minutes gone is not "inside five minutes".
    expect(rateResponse(SLA_TARGET_SECONDS)).toBe('good');
    expect(rateResponse(900)).toBe('fair');
  });

  it('refuses a negative or non-finite time instead of rating it', () => {
    // A negative response time means a clock went backwards or a lead was
    // re-parented. Rating it 'excellent' would bury that.
    expect(() => rateResponse(-1)).toThrow();
    expect(() => rateResponse(Number.NaN)).toThrow();
    expect(() => rateResponse(Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe('the SLA bar', () => {
  it('fills over the target and never overflows', () => {
    expect(slaFraction(0)).toBe(0);
    expect(slaFraction(150)).toBeCloseTo(0.5);
    expect(slaFraction(300)).toBe(1);
    expect(slaFraction(3000)).toBe(1);
  });
});

describe('what the board shouts', () => {
  it('is fresh under five minutes', () => {
    expect(leadAgeBand(0, { assigned: false })).toBe('fresh');
    expect(leadAgeBand(299, { assigned: true })).toBe('fresh');
  });

  it('wants a handoff between five and fifteen', () => {
    expect(leadAgeBand(300, { assigned: false })).toBe('handoff_due');
    expect(leadAgeBand(899, { assigned: false })).toBe('handoff_due');
  });

  it('escalates only an UNASSIGNED lead past fifteen minutes', () => {
    expect(leadAgeBand(900, { assigned: false })).toBe('escalate');
    // Assigned is somebody's problem and already on their screen; painting it
    // red too makes the colour mean nothing.
    expect(leadAgeBand(900, { assigned: true })).toBe('handoff_due');
  });
});

describe('summarising a store’s day', () => {
  it('counts every lead exactly once, contacted or not', () => {
    const s = summarise([
      { responseTimeSeconds: 30, firstTouchByAi: true },
      { responseTimeSeconds: 600, firstTouchByAi: false },
      { responseTimeSeconds: null, firstTouchByAi: false },
    ]);
    expect(s.contacted).toBe(2);
    expect(s.uncontacted).toBe(1);
    expect(s.byRating).toEqual({ excellent: 1, good: 1, fair: 0, slow: 0 });
  });

  it('reports a median, because one terrible lead moves a mean and not a median', () => {
    const s = summarise([
      { responseTimeSeconds: 10, firstTouchByAi: true },
      { responseTimeSeconds: 20, firstTouchByAi: true },
      { responseTimeSeconds: 259_200, firstTouchByAi: false },
    ]);
    expect(s.medianSeconds).toBe(20);
  });

  it('takes the middle pair when the count is even', () => {
    const s = summarise([
      { responseTimeSeconds: 10, firstTouchByAi: false },
      { responseTimeSeconds: 21, firstTouchByAi: false },
    ]);
    expect(s.medianSeconds).toBe(15);
  });

  it('has no median when nobody has been contacted', () => {
    const s = summarise([{ responseTimeSeconds: null, firstTouchByAi: false }]);
    expect(s.medianSeconds).toBeNull();
  });

  it('measures the SLO against the assistant’s touches only', () => {
    const s = summarise([
      { responseTimeSeconds: 59, firstTouchByAi: true },
      { responseTimeSeconds: 60, firstTouchByAi: true },
      // A person answering in four seconds is excellent service and says
      // nothing about whether the assistant is meeting its SLO.
      { responseTimeSeconds: 4, firstTouchByAi: false },
    ]);
    expect(s.aiTouches).toBe(2);
    expect(s.aiWithinSlo).toBe(1);
    expect(AI_FIRST_TOUCH_SLO_SECONDS).toBe(60);
  });
});
