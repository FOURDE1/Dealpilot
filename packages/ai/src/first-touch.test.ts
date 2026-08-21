import { describe, expect, it } from 'vitest';
import { firstTouchMessage, safeFirstTouchMessage } from './first-touch.js';
import { outboundGuard } from './guards/outbound-guard.js';

const BASE = {
  firstName: 'Gilles',
  personaName: 'Camille',
  dealership: 'Kia Mont-Laurier',
  vehicleInterest: 'Kia Sportage',
  isDuplicate: false,
} as const;

describe('the first touch template (§6)', () => {
  it('FR carries identification and ARRÊT — the mandatory parts, in order', () => {
    const m = firstTouchMessage({ ...BASE, language: 'fr' });
    expect(m).toBe(
      'Bonjour Gilles! Ici Camille, l’assistant virtuel de Kia Mont-Laurier — merci de votre intérêt pour Kia Sportage. (Répondez ARRÊT pour vous désabonner)',
    );
  });

  it('EN carries identification and STOP', () => {
    const m = firstTouchMessage({ ...BASE, language: 'en' });
    expect(m).toContain("It's Camille, the virtual assistant at Kia Mont-Laurier");
    expect(m).toContain('(Reply STOP to opt out)');
  });

  it('a duplicate submission opens by confirming, never by starting over', () => {
    const m = firstTouchMessage({ ...BASE, language: 'en', isDuplicate: true });
    expect(m).toContain('already submitted');
    expect(m).not.toContain('thanks for your interest in Kia Sportage');
  });

  it('missing name and vehicle degrade gracefully — never "Hi null"', () => {
    const m = firstTouchMessage({ ...BASE, firstName: null, vehicleInterest: null, language: 'en' });
    expect(m.startsWith('Hi! ')).toBe(true);
    expect(m).toContain('your next vehicle');
    expect(m).not.toContain('null');
  });

  it('every variant is guard-clean under the REAL flag (isServerTemplate false - the bot path)', () => {
    for (const language of ['fr', 'en'] as const) {
      for (const isDuplicate of [false, true]) {
        for (const vehicleInterest of ['Kia Sportage', null]) {
          const m = firstTouchMessage({ ...BASE, language, isDuplicate, vehicleInterest });
          expect(outboundGuard(m, { allowedStockNumbers: [], isServerTemplate: false })).toEqual([]);
        }
      }
    }
  });

  it('a price-shaped vehicle_interest degrades to the generic phrase instead of tripping the gate', () => {
    const m = safeFirstTouchMessage({ ...BASE, language: 'en', vehicleInterest: 'Kia Rio 0% financing $99/wk' });
    expect(m).toContain('your next vehicle');
    expect(m).not.toContain('%');
    expect(m).not.toContain('$');
    expect(outboundGuard(m, { allowedStockNumbers: [], isServerTemplate: false })).toEqual([]);
  });
});
