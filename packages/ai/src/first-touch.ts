import { outboundGuard } from './guards/outbound-guard.js';

/**
 * F-59 — the first touch (compliance-and-quality.md §6, conversation-engine.md §3).
 *
 * TEMPLATED, NOT MODEL-GENERATED — deliberately. The first message carries
 * the legally-mandatory parts (AI self-identification, the STOP/ARRÊT
 * opt-out) and a template is the only author that cannot be talked out of
 * including them. It may exceed 160 characters for exactly that reason;
 * every later message is the model's, under the <160 rule.
 */

export interface FirstTouchInput {
  readonly firstName: string | null;
  readonly personaName: string;
  readonly dealership: string;
  readonly vehicleInterest: string | null;
  readonly language: 'fr' | 'en';
  /** §3: a duplicate submission opens by confirming, never by starting over. */
  readonly isDuplicate: boolean;
}

/**
 * The composition the WORKER uses: the interest variant when it survives the
 * guard, the generic phrase when the provider shipped a price-shaped
 * vehicle_interest ("Rio 0% financement") that would trip it. The null
 * variant is clean by construction - the guard-clean test pins that with
 * isServerTemplate FALSE, the flag production actually runs under.
 */
export function safeFirstTouchMessage(i: FirstTouchInput): string {
  const withInterest = firstTouchMessage(i);
  if (outboundGuard(withInterest, { allowedStockNumbers: [], isServerTemplate: false }).length === 0) {
    return withInterest;
  }
  return firstTouchMessage({ ...i, vehicleInterest: null });
}

export function firstTouchMessage(i: FirstTouchInput): string {
  const fr = i.language === 'fr';
  const greet = i.firstName
    ? fr ? `Bonjour ${i.firstName}!` : `Hi ${i.firstName}!`
    : fr ? 'Bonjour!' : 'Hi!';
  const intro = fr
    ? `Ici ${i.personaName}, l’assistant virtuel de ${i.dealership}`
    : `It's ${i.personaName}, the virtual assistant at ${i.dealership}`;
  const interest = i.isDuplicate
    ? fr
      ? ' — on dirait que vous nous avez déjà soumis une demande. Toujours à la recherche d’un véhicule?'
      : ' — it looks like you’ve already submitted an application with us. Still interested in finding a vehicle?'
    : fr
      ? ` — merci de votre intérêt pour ${i.vehicleInterest ?? 'votre prochain véhicule'}.`
      : ` — thanks for your interest in ${i.vehicleInterest ?? 'your next vehicle'}.`;
  const optOut = fr ? ' (Répondez ARRÊT pour vous désabonner)' : ' (Reply STOP to opt out)';
  return `${greet} ${intro}${interest}${optOut}`;
}
