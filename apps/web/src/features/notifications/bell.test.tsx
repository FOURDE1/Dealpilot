import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { createI18n, type Locale } from '@dealpilot/i18n';
import type { NotificationT } from '@dealpilot/schemas';

/**
 * F-72 A10 — the consumer that makes writing BOTH titles honest.
 *
 * The fan-out cannot know which language a recipient reads: `users.language_pref`
 * has no producer in this system, so the row carries `title_en` AND `title_fr`
 * and the bell picks at display time (migration 0051's own rule). If that
 * collapse is ever deleted, a French reader gets the English title — or, worse,
 * ICU renders the literal `{title}` — and nothing else in the build notices.
 *
 * Rendered for real (react-dom/server, no DOM needed) rather than asserted
 * against the helper, so the test fails if the bell stops CALLING it.
 */

const list: { unread: number; items: NotificationT[] } = {
  unread: 2,
  items: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      organization_id: '22222222-2222-4222-8222-222222222222',
      user_id: '33333333-3333-4333-8333-333333333333',
      store_id: null,
      urgency: 'high',
      title_key: 'notif_announcement_published',
      params: { title_en: 'Twilio outage', title_fr: 'Panne Twilio' },
      link: null,
      entity_type: 'announcement',
      entity_id: '44444444-4444-4444-8444-444444444444',
      read_at: null,
      channels_sent: [],
      created_at: '2026-08-30T12:00:00.000Z',
    },
    {
      id: '55555555-5555-4555-8555-555555555555',
      organization_id: '22222222-2222-4222-8222-222222222222',
      user_id: '33333333-3333-4333-8333-333333333333',
      store_id: null,
      urgency: 'low',
      title_key: 'notif_lead_assigned',
      params: { lead: 'Marie Tremblay' },
      link: '/leads/66666666-6666-4666-8666-666666666666',
      entity_type: 'lead',
      entity_id: '66666666-6666-4666-8666-666666666666',
      read_at: '2026-08-30T12:05:00.000Z',
      channels_sent: [],
      created_at: '2026-08-30T12:04:00.000Z',
    },
  ],
};

vi.mock('./api.js', () => ({
  notificationKeys: { all: ['notifications'] as const },
  useNotifications: () => ({ data: list }),
  useMarkRead: () => ({ mutate: () => undefined, isPending: false }),
  useMarkAllRead: () => ({ mutate: () => undefined, isPending: false }),
}));

const { NotificationsBell } = await import('./bell.js');

function bellMarkup(locale: Locale): string {
  // strictIcu: a params/argument mismatch throws here instead of quietly
  // rendering the raw "{title}" a dealer would otherwise read.
  const i18n = createI18n({ locale, strictIcu: true });
  return renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(MemoryRouter, null, createElement(NotificationsBell)),
    ),
  );
}

describe('the bell renders an announcement in the reader\'s own language', () => {
  it('shows the French title under fr-CA', () => {
    const html = bellMarkup('fr-CA');
    expect(html).toContain('Panne Twilio');
    expect(html).not.toContain('Twilio outage');
    // The key itself must never reach the screen, and neither must the raw
    // ICU argument a one-sided params shape would leave behind.
    expect(html).not.toContain('notif_announcement_published');
    expect(html).not.toContain('{title}');
  });

  it('shows the English title under en-CA, from the same row', () => {
    const html = bellMarkup('en-CA');
    expect(html).toContain('Announcement: Twilio outage');
    expect(html).not.toContain('Panne Twilio');
  });

  it('leaves every other producer\'s params untouched', () => {
    expect(bellMarkup('fr-CA')).toContain('Le prospect Marie Tremblay vous a été assigné.');
    expect(bellMarkup('en-CA')).toContain('Lead Marie Tremblay was assigned to you.');
  });
});
