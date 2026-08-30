import { describe, expect, it } from 'vitest';
import { ANNOUNCEMENT_SEVERITIES, type AnnouncementSeverityT, type AnnouncementT } from '@dealpilot/schemas';
import { splitAnnouncements } from './order.js';

/**
 * F-72 R4: two mounts, one rule. If this function ever disagrees with itself
 * an announcement either shows twice or vanishes from the shell — and a
 * platform incident that nobody sees is the whole failure this slice exists
 * to prevent.
 */

const at = (severity: AnnouncementSeverityT, startsAt: string): AnnouncementT => ({
  id: `${severity}-${startsAt}`,
  severity,
  title_en: severity,
  title_fr: severity,
  body_en: severity,
  body_fr: severity,
  dismissible: severity === 'info' || severity === 'marketing',
  starts_at: startsAt,
  ends_at: null,
  status_incident_url: severity === 'incident' ? 'https://status.example.com/i/1' : null,
});

describe('splitAnnouncements', () => {
  it('sends incident and maintenance to the banner, info and marketing to the notices', () => {
    const { banner, notices } = splitAnnouncements([
      at('info', '2026-08-01T00:00:00.000Z'),
      at('incident', '2026-08-02T00:00:00.000Z'),
      at('marketing', '2026-08-03T00:00:00.000Z'),
      at('maintenance', '2026-08-04T00:00:00.000Z'),
    ]);
    expect(banner.map((a) => a.severity)).toEqual(['incident', 'maintenance']);
    expect(notices.map((a) => a.severity)).toEqual(['info', 'marketing']);
  });

  it('orders each group by urgency, then by the most recently started', () => {
    const { banner, notices } = splitAnnouncements([
      at('maintenance', '2026-08-01T00:00:00.000Z'),
      at('incident', '2026-08-02T00:00:00.000Z'),
      at('incident', '2026-08-05T00:00:00.000Z'),
      at('marketing', '2026-08-03T00:00:00.000Z'),
      at('info', '2026-08-06T00:00:00.000Z'),
      at('info', '2026-08-07T00:00:00.000Z'),
    ]);
    expect(banner.map((a) => a.id)).toEqual([
      'incident-2026-08-05T00:00:00.000Z',
      'incident-2026-08-02T00:00:00.000Z',
      'maintenance-2026-08-01T00:00:00.000Z',
    ]);
    expect(notices.map((a) => a.id)).toEqual([
      'info-2026-08-07T00:00:00.000Z',
      'info-2026-08-06T00:00:00.000Z',
      'marketing-2026-08-03T00:00:00.000Z',
    ]);
  });

  it('gives two empty groups for an empty feed, so both mounts self-gate', () => {
    expect(splitAnnouncements([])).toEqual({ banner: [], notices: [] });
  });

  it('places every severity the vocabulary declares in exactly one group', () => {
    // The vacuity check: four severities exist today, and the assertion below
    // is only worth anything because the input covers all of them.
    expect(ANNOUNCEMENT_SEVERITIES).toHaveLength(4);
    const items = ANNOUNCEMENT_SEVERITIES.map((s, i) => at(s, `2026-08-0${i + 1}T00:00:00.000Z`));
    const { banner, notices } = splitAnnouncements(items);
    const placed = [...banner, ...notices].map((a) => a.id).sort();
    expect(placed).toEqual(items.map((a) => a.id).sort());
    expect(new Set(placed).size).toBe(items.length);
  });
});
