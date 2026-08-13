import { describe, expect, it } from 'vitest';
import { enCA, frCA } from '@dealpilot/i18n';
import { formatDuration, sloState, type SloState } from './speed.js';

/**
 * The dashboard is where the speed-to-lead claim gets tested against reality
 * every morning, so the two ways it could lie are what this covers: calling a
 * missed service level healthy, and rounding a delay into something prettier
 * than it was.
 */

describe('the assistant’s service level', () => {
  it('is unknown when nothing was measured, never “meeting”', () => {
    // A service level nothing was measured against has not been met, and a
    // green badge on an empty store is the most confident kind of wrong.
    expect(sloState(0, 0)).toBe('unknown');
  });

  it('meets it at 95% and above', () => {
    expect(sloState(95, 100)).toBe('meeting');
    expect(sloState(100, 100)).toBe('meeting');
  });

  it('slips between 80 and 95, rather than being a second kind of fine', () => {
    expect(sloState(94, 100)).toBe('slipping');
    expect(sloState(80, 100)).toBe('slipping');
    // 88% reported as healthy is a number nobody fixes until a customer
    // complains.
    expect(sloState(88, 100)).toBe('slipping');
  });

  it('is breached below 80', () => {
    expect(sloState(79, 100)).toBe('breached');
    expect(sloState(0, 3)).toBe('breached');
  });
});

describe('showing a duration', () => {
  it('reads at a glance across the range', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(59)).toBe('59s');
    expect(formatDuration(60)).toBe('1m');
    expect(formatDuration(3599)).toBe('59m');
    expect(formatDuration(3600)).toBe('1h');
    expect(formatDuration(86_400)).toBe('1d');
  });

  it('rounds down, so a delay is never overstated or flattered', () => {
    // 119s is one minute and change. "2m" overstates it; "1m" is honest.
    expect(formatDuration(119)).toBe('1m');
    expect(formatDuration(7199)).toBe('1h');
  });

  it('shows a dash rather than inventing a number', () => {
    expect(formatDuration(-1)).toBe('—');
    expect(formatDuration(Number.NaN)).toBe('—');
  });
});

describe('every state the badge can be in', () => {
  it('has a label in both locales', () => {
    const states: SloState[] = ['meeting', 'slipping', 'breached', 'unknown'];
    const en = enCA.dashboard as Record<string, string>;
    const fr = frCA.dashboard as Record<string, string>;
    for (const s of states) {
      expect(en[`speedSlo_${s}`]?.trim(), `en-CA speedSlo_${s}`).toBeTruthy();
      expect(fr[`speedSlo_${s}`]?.trim(), `fr-CA speedSlo_${s}`).toBeTruthy();
    }
  });
});
