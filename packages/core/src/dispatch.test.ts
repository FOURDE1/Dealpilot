import { describe, expect, it } from 'vitest';
import { canTransition, driverRequirement, findConflict, releasesResources } from './dispatch.js';

/**
 * F-11 dispatch rules. Golden cases from dispatch-transport.md §4 and §6 — the
 * legacy code is the executable spec (ADR-026), so these encode what it does,
 * except where the spec itself names the behaviour as a defect to fix.
 */

describe('drivers-needed and chaser rule (§4)', () => {
  it('a trade-in means one driver and no chaser', () => {
    // The driver delivers the sold car and drives the trade-in home.
    expect(driverRequirement(true)).toEqual({ numDrivers: 1, needsChaser: false });
  });

  it('no trade-in means two drivers and a chaser', () => {
    // Otherwise driver one is standing in a customer's driveway with no ride.
    expect(driverRequirement(false)).toEqual({ numDrivers: 2, needsChaser: true });
  });
});

describe('4-hour conflict detection (§6)', () => {
  const noon = new Date('2026-08-01T12:00:00Z');
  const book = (iso: string, dealId = 'other-deal') => ({ dealId, bookedAt: new Date(iso) });

  it('flags a booking inside the window', () => {
    const r = findConflict(noon, [book('2026-08-01T15:00:00Z')], 4);
    expect(r.conflict).toBe(true);
    expect(r.against?.dealId).toBe('other-deal');
  });

  it('does not flag one outside it', () => {
    expect(findConflict(noon, [book('2026-08-01T16:30:00Z')], 4).conflict).toBe(false);
  });

  it('is symmetric — earlier collides exactly as later does', () => {
    expect(findConflict(noon, [book('2026-08-01T09:00:00Z')], 4).conflict).toBe(true);
    expect(findConflict(noon, [book('2026-08-01T07:30:00Z')], 4).conflict).toBe(false);
  });

  it('exactly the window away is not a conflict', () => {
    // A boundary someone will hit: back-to-back afternoon runs.
    expect(findConflict(noon, [book('2026-08-01T16:00:00Z')], 4).conflict).toBe(false);
  });

  it('honours a store-specific window', () => {
    // Rural Quebec is not downtown Montreal; 4 hours is a guess about geography.
    expect(findConflict(noon, [book('2026-08-01T15:00:00Z')], 2).conflict).toBe(false);
    expect(findConflict(noon, [book('2026-08-01T15:00:00Z')], 8).conflict).toBe(true);
  });

  it('compares DELIVERY times, not booking times — the legacy defect', () => {
    // Both deliveries are on 1 August at noon and 2pm: a real collision, one
    // plate. Legacy compared when each was BOOKED (days apart), so it saw
    // nothing. This is the case the rebuild exists to catch.
    const bookedDaysApartSameAfternoon = [book('2026-08-01T14:00:00Z')];
    expect(findConflict(noon, bookedDaysApartSameAfternoon, 4).conflict).toBe(true);

    // And the mirror image: two runs booked in the same morning for afternoons
    // a week apart are NOT a collision, though legacy flagged them.
    expect(findConflict(noon, [book('2026-08-08T12:00:00Z')], 4).conflict).toBe(false);
  });

  it('nothing booked is never a conflict', () => {
    expect(findConflict(noon, [], 4).conflict).toBe(false);
  });
});

describe('one lifecycle (ADR-009)', () => {
  it('moves forward through the real-world steps', () => {
    expect(canTransition('pending', 'assigned')).toBe(true);
    expect(canTransition('assigned', 'departed')).toBe(true);
    expect(canTransition('departed', 'arrived')).toBe(true);
    expect(canTransition('arrived', 'completed')).toBe(true);
  });

  it('cannot skip a step', () => {
    // "Arrived" without "departed" means the ETA the customer was given was
    // never true.
    expect(canTransition('assigned', 'arrived')).toBe(false);
    expect(canTransition('pending', 'completed')).toBe(false);
  });

  it('cannot go backwards, and an ended run stays ended', () => {
    expect(canTransition('departed', 'assigned')).toBe(false);
    expect(canTransition('completed', 'departed')).toBe(false);
    expect(canTransition('cancelled', 'assigned')).toBe(false);
  });

  it('can be cancelled from anywhere still in flight', () => {
    for (const from of ['pending', 'assigned', 'departed', 'arrived']) {
      expect(canTransition(from, 'cancelled'), `${from} → cancelled`).toBe(true);
    }
  });

  it('resources come back whether it finished or was called off', () => {
    expect(releasesResources('completed')).toBe(true);
    expect(releasesResources('cancelled')).toBe(true);
    // A truck that has departed is still holding the plate.
    expect(releasesResources('departed')).toBe(false);
  });
});
