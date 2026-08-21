import { describe, expect, it } from 'vitest';
import { dripTickDecision, lostConditionMatches, renderDripBody, type DripStep } from './drip.js';

const steps: DripStep[] = [
  { day: 0, body_fr: 'Bonjour {{first_name}}', body_en: 'Hello {{first_name}}' },
  {
    day: 7,
    body_fr: 'Toujours intéressé par {{vehicle}}?',
    body_en: 'Still interested in {{vehicle}}?',
  },
  { day: 30, body_fr: 'On pense à vous', body_en: 'Thinking of you' },
];

const enrolledAt = new Date('2026-08-01T15:00:00Z');
const expiresAt = new Date('2026-11-01T15:00:00Z');

describe('dripTickDecision', () => {
  it('sends a day-0 step immediately', () => {
    const d = dripTickDecision({ currentStep: 0, enrolledAt, expiresAt }, steps, enrolledAt);
    expect(d).toEqual({ kind: 'send', stepIndex: 0, step: steps[0] });
  });

  it('waits while the next step is in the future', () => {
    const d = dripTickDecision(
      { currentStep: 1, enrolledAt, expiresAt },
      steps,
      new Date('2026-08-05T15:00:00Z'),
    );
    expect(d.kind).toBe('wait');
  });

  it('sends the moment the step day arrives', () => {
    const d = dripTickDecision(
      { currentStep: 1, enrolledAt, expiresAt },
      steps,
      new Date('2026-08-08T15:00:00Z'),
    );
    expect(d).toEqual({ kind: 'send', stepIndex: 1, step: steps[1] });
  });

  it('expiry beats an overdue step — day 91 sends nothing', () => {
    const d = dripTickDecision(
      { currentStep: 2, enrolledAt, expiresAt: new Date('2026-08-20T15:00:00Z') },
      steps,
      new Date('2026-09-01T15:00:00Z'),
    );
    expect(d.kind).toBe('expire');
  });

  it('completes once every step has gone out', () => {
    const d = dripTickDecision(
      { currentStep: 3, enrolledAt, expiresAt },
      steps,
      new Date('2026-09-05T15:00:00Z'),
    );
    expect(d.kind).toBe('complete');
  });
});

describe('renderDripBody', () => {
  const step = (body_fr: string, body_en = body_fr): Pick<DripStep, 'body_fr' | 'body_en'> => ({
    body_fr,
    body_en,
  });

  it('picks the language of the conversation and merges §12 fields', () => {
    const body = renderDripBody(
      step('Bonjour {{first_name}}, des nouvelles de {{store_name}}!', 'Hello {{first_name}}!'),
      { first_name: 'Marie', store_name: 'Kia Mont-Laurier' },
      'fr',
    );
    expect(body).toBe(
      'Bonjour Marie, des nouvelles de Kia Mont-Laurier! (Répondez ARRÊT pour vous désabonner)',
    );
  });

  it('a missing field vanishes without leaving its token or double spaces', () => {
    const body = renderDripBody(
      step('Hi {{first_name}} , still shopping for {{vehicle}}?'),
      { store_name: 'Kia Mont-Laurier' },
      'en',
    );
    expect(body).not.toContain('{');
    expect(body).not.toContain('  ');
    expect(body).toBe(
      'Hi, still shopping for? — Kia Mont-Laurier (Reply STOP to opt out)',
    );
  });

  it('a token this code does not know is a typo, never customer-visible', () => {
    const body = renderDripBody(step('Salut {{frist_name}}, ça va?'), {}, 'fr');
    expect(body).not.toContain('{');
    expect(body).toContain('Salut, ça va?');
  });

  it('CASL identification: the store name is appended when the body lacks it', () => {
    const body = renderDripBody(
      step('De nouvelles arrivées cette semaine!'),
      { store_name: 'Kia Mont-Laurier' },
      'fr',
    );
    expect(body).toContain('— Kia Mont-Laurier');
  });

  it('skips the footer only for a WHOLE opt-out word — financement/weekend do not count', () => {
    const fr = renderDripBody(step('Le financement est approuvé!'), {}, 'fr');
    expect(fr).toContain('ARRÊT');
    const en = renderDripBody(step('', 'Great deals this weekend!'), {}, 'en');
    expect(en).toContain('STOP');
    const taught = renderDripBody(step('Répondez ARRET pour arrêter.'), {}, 'fr');
    expect(taught).toBe('Répondez ARRET pour arrêter.');
  });

  it('the language of the footer follows the conversation, not the template', () => {
    const body = renderDripBody(step('Bonjour encore!', 'Hello again!'), {}, 'fr');
    expect(body).toContain('ARRÊT');
  });
});

describe('lostConditionMatches', () => {
  const reason = { name: 'Ghosted', name_fr: 'Sans réponse' };

  it('an empty condition matches every loss', () => {
    expect(lostConditionMatches({}, reason)).toBe(true);
  });

  it('matches either language, case-insensitively', () => {
    expect(lostConditionMatches({ lost_reason: 'ghosted' }, reason)).toBe(true);
    expect(lostConditionMatches({ lost_reason: 'SANS RÉPONSE' }, reason)).toBe(true);
  });

  it('a different reason does not match', () => {
    expect(lostConditionMatches({ lost_reason: 'Payment too high' }, reason)).toBe(false);
  });
});
