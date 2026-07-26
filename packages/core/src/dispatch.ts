/**
 * F-11 dispatch rules (dispatch-transport.md §4, §6).
 *
 * The logistics core, kept pure so it can be reasoned about and tested without
 * a database — the same treatment the money engine gets. Everything here is a
 * decision a dispatcher would recognise; nothing here talks to Postgres.
 */

export interface DriverRequirement {
  /** A second driver exists only to bring the first one home. */
  numDrivers: number;
  needsChaser: boolean;
}

/**
 * The core rule, and the reason it is not arbitrary:
 *
 *   trade-in  → 1 driver, no chaser. The driver delivers the sold car and
 *               drives the trade-in back, so they get themselves home.
 *   no trade  → 2 drivers + a chaser. Driver 1 delivers the sold car and would
 *               otherwise be stranded; driver 2 follows and brings them back.
 */
export function driverRequirement(hasTradeIn: boolean): DriverRequirement {
  return hasTradeIn ? { numDrivers: 1, needsChaser: false } : { numDrivers: 2, needsChaser: true };
}

export interface ResourceBooking {
  /** The other assignment's deal — for the human-readable reason. */
  dealId: string;
  /** When that delivery is actually booked for. */
  bookedAt: Date;
}

export interface ConflictCheck {
  conflict: boolean;
  /** The colliding booking, when there is one. */
  against?: ResourceBooking;
}

/**
 * Does booking this resource at `bookedAt` collide with an existing booking?
 *
 * The window is ±N hours around the DELIVERY TIME. The legacy implementation
 * compared `assigned_at` — when the booking was MADE — which meant two
 * deliveries booked days apart for the same afternoon were never flagged, while
 * two booked in the same morning for different afternoons always were. It was
 * measuring office activity, not truck availability. This measures the thing
 * that actually collides: a plate cannot be in two places at once.
 */
export function findConflict(
  bookedAt: Date,
  existing: readonly ResourceBooking[],
  windowHours: number,
): ConflictCheck {
  const windowMs = windowHours * 60 * 60 * 1000;
  for (const other of existing) {
    if (Math.abs(other.bookedAt.getTime() - bookedAt.getTime()) < windowMs) {
      return { conflict: true, against: other };
    }
  }
  return { conflict: false };
}

/** The lifecycle a dispatch run may move through (one vocabulary, ADR-009). */
export const DISPATCH_TRANSITIONS: Record<string, readonly string[]> = {
  // Booking IS the assignment, so a run starts at 'assigned'. There is no
  // 'pending': a status nothing can produce only makes the board harder to read.
  assigned: ['departed', 'cancelled'],
  departed: ['arrived', 'cancelled'],
  arrived: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

/**
 * A run moves forward, or it is cancelled. It never jumps: "arrived" without
 * "departed" would mean the ETA board was never true, and the board is what
 * the customer is being told.
 */
export function canTransition(from: string, to: string): boolean {
  return (DISPATCH_TRANSITIONS[from] ?? []).includes(to);
}

/** Resources go back on the board when a run ends, either way. */
export function releasesResources(status: string): boolean {
  return status === 'completed' || status === 'cancelled';
}
