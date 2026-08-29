import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import type { FastifyBaseLogger } from 'fastify';
import type { Env } from './env.js';

/**
 * Transactional email (A-11) via Amazon SES in ca-central-1 (D-029/D-030).
 *
 * Two transports:
 *  - `log`  — default outside production: renders the message to the logger.
 *    Local dev, CI, and tests need no AWS credentials and can never emit real
 *    mail (an accidental send to a customer is not a recoverable mistake).
 *  - `ses`  — real send through the verified 1dealer.ca identity.
 *
 * The account is still in the SES sandbox (D-030), so real sends only reach
 * verified addresses or the SES mailbox simulator until production access is
 * requested. A send failure NEVER takes down the caller's request: sign-up must
 * succeed even when mail is degraded, so failures are logged and surfaced as a
 * boolean, not thrown (the user can request a new verification link).
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(message: EmailMessage): Promise<boolean>;
  /**
   * Whether a successful send actually reaches the recipient's inbox.
   *
   * The dev log transport returns true from send() — it did what it was asked —
   * but the message went to pino, which nobody's customer or new colleague is
   * reading. Callers that hand out a one-time link (invitations) need to know
   * the difference so they can surface the link instead of telling someone an
   * email is on its way that never will be (CR-05, Hussein).
   */
  readonly deliversToRecipient: boolean;
}

const SEND_TIMEOUT_MS = 10_000;

export function createMailer(env: Env, logger: FastifyBaseLogger): Mailer {
  if (env.EMAIL_TRANSPORT === 'log') {
    return {
      // It writes a log line; it does not reach anybody.
      deliversToRecipient: false,
      async send(message) {
        // Subject/recipient only — bodies can carry tokens (CLAUDE.md: no
        // secrets in logs). The token is visible in dev via the link below.
        logger.info({ to: message.to, subject: message.subject, body: message.text }, 'email (log transport)');
        return true;
      },
    };
  }

  const client = new SESv2Client({
    region: env.AWS_REGION,
    requestHandler: { requestTimeout: SEND_TIMEOUT_MS },
  });

  return {
    // SES puts it in a real inbox.
    deliversToRecipient: true,
    async send(message) {
      try {
        await client.send(
          new SendEmailCommand({
            FromEmailAddress: env.EMAIL_FROM,
            Destination: { ToAddresses: [message.to] },
            Content: {
              Simple: {
                Subject: { Data: message.subject, Charset: 'UTF-8' },
                Body: {
                  Text: { Data: message.text, Charset: 'UTF-8' },
                  ...(message.html ? { Html: { Data: message.html, Charset: 'UTF-8' } } : {}),
                },
              },
            },
          }),
        );
        logger.info({ to: message.to, subject: message.subject }, 'email sent');
        return true;
      } catch (err) {
        // Degraded, not fatal: the caller's request still succeeds.
        logger.error({ err, to: message.to }, 'email send failed');
        return false;
      }
    },
  };
}

/**
 * Sign-up verification message. FR-first (Bill 96) with the English
 * equivalent below — one bilingual message avoids needing a locale on an
 * identity that has not signed in yet.
 */
export function verificationMessage(to: string, url: string): EmailMessage {
  return {
    to,
    subject: 'Confirmez votre adresse courriel / Confirm your email — 1Dealer',
    text: [
      'Bonjour,',
      '',
      'Confirmez votre adresse courriel pour activer votre compte 1Dealer :',
      url,
      '',
      "Si vous n'avez pas créé ce compte, ignorez ce message.",
      '',
      '— — —',
      '',
      'Hello,',
      '',
      'Confirm your email address to activate your 1Dealer account:',
      url,
      '',
      'If you did not create this account, you can ignore this message.',
    ].join('\n'),
  };
}

/** F-12: the invitation link. FR first (Bill 96), same shape as verification. */
export function invitationMessage(to: string, url: string): EmailMessage {
  return {
    to,
    subject: "Invitation à rejoindre l'équipe / You have been invited — 1Dealer",
    text: [
      'Bonjour,',
      '',
      'Vous avez été invité à rejoindre une équipe sur 1Dealer.',
      'Créez votre mot de passe et accédez à votre compte ici :',
      url,
      '',
      "Ce lien expire dans 7 jours et ne peut servir qu'une seule fois.",
      "Si vous ne vous attendiez pas à cette invitation, ignorez ce message.",
      '',
      '— — —',
      '',
      'Hello,',
      '',
      'You have been invited to join a team on 1Dealer.',
      'Set your password and get access here:',
      url,
      '',
      'This link expires in 7 days and can only be used once.',
      'If you were not expecting this invitation, you can ignore this message.',
    ].join('\n'),
  };
}

/**
 * F-71 (admin-console.md §7): the tenant owner is told, at the moment it
 * starts, that platform support is acting as one of their members — who,
 * in which mode, why, until when. FR first (Bill 96), same shape as the
 * others. Sent AFTER the register row commits (F-70 parity).
 */
export function supportAccessMessage(
  to: string,
  f: { orgName: string; targetName: string; mode: 'read_only' | 'full'; reason: string; ticketRef: string | null; expiresAt: Date },
): EmailMessage {
  const when = f.expiresAt.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const modeFr = f.mode === 'full' ? 'complète (modifications permises, sauf les pouvoirs bloqués)' : 'en lecture seule';
  const modeEn = f.mode === 'full' ? 'full (changes allowed, except the blocked powers)' : 'read-only';
  const ticketFr = f.ticketRef ? `Billet : ${f.ticketRef}` : 'Aucun billet indiqué';
  const ticketEn = f.ticketRef ? `Ticket: ${f.ticketRef}` : 'No ticket given';
  return {
    to,
    subject: `Accès du soutien à ${f.orgName} / Support access to ${f.orgName} — 1Dealer`,
    text: [
      'Bonjour,',
      '',
      `Le soutien 1Dealer a ouvert une session ${modeFr} au nom de ${f.targetName} chez ${f.orgName}.`,
      `Raison : ${f.reason}`,
      ticketFr,
      `La session se termine au plus tard le ${when}.`,
      'Chaque session est inscrite au registre de votre organisation (Sécurité du compte → Accès du soutien).',
      '',
      '— — —',
      '',
      'Hello,',
      '',
      `1Dealer support opened a ${modeEn} session acting as ${f.targetName} at ${f.orgName}.`,
      `Reason: ${f.reason}`,
      ticketEn,
      `The session ends no later than ${when}.`,
      'Every session is listed in your organization’s register (Account security → Support access).',
    ].join('\n'),
  };
}

/** Everything a driver needs before they get in the car (dispatch §9/§10). */
export interface DispatchRequest {
  to: string;
  vehicle: string;
  deliveryDate: string;
  pickupAddress: string | null;
  deliveryAddress: string | null;
  driversNeeded: number;
  hasTradeIn: boolean;
  cashToCollectCents: number;
  wetInkReady: boolean;
  plateNumber: string | null;
  chaserName: string | null;
  specialInstructions: string | null;
  storeName: string;
}

const money = (cents: number, locale: string) =>
  new Intl.NumberFormat(locale, { style: 'currency', currency: 'CAD' }).format(cents / 100);

/**
 * The driver request. FR first (Bill 96) — the legacy template was hardcoded
 * English and named one store, which ADR-018 calls a release blocker; the store
 * name is passed in and both languages are always sent, because the driver
 * companies a Quebec dealer group uses are not reliably bilingual in either
 * direction.
 *
 * Note what is spelled out rather than assumed: WHY the second driver exists.
 * A dispatcher reading "2 drivers" can forget; a driver reading "no trade-in to
 * drive back, so a second driver follows and brings the first one home" cannot
 * misread it.
 */
export function dispatchRequestMessage(r: DispatchRequest): EmailMessage {
  const fr: string[] = [
    'Bonjour,',
    '',
    `Demande de chauffeur — ${r.storeName}`,
    '',
    `Véhicule : ${r.vehicle}`,
    `Date de livraison : ${r.deliveryDate}`,
    r.pickupAddress ? `Adresse de départ : ${r.pickupAddress}` : "Adresse de départ : à confirmer",
    r.deliveryAddress ? `Adresse de livraison : ${r.deliveryAddress}` : 'Adresse de livraison : à confirmer',
    '',
    `Chauffeurs requis : ${r.driversNeeded}`,
    r.hasTradeIn
      ? "  (échange à ramener — le chauffeur revient avec le véhicule d'échange)"
      : "  (aucun échange — un deuxième chauffeur suit et ramène le premier)",
    r.plateNumber ? `Plaque de commerçant : ${r.plateNumber}` : '',
    r.chaserName ? `Véhicule suiveur : ${r.chaserName}` : '',
    '',
    r.cashToCollectCents > 0 ? `ARGENT À PERCEVOIR : ${money(r.cashToCollectCents, 'fr-CA')}` : 'Aucun montant à percevoir.',
    r.wetInkReady ? 'Dossier signé : prêt.' : 'Dossier signé : PAS ENCORE PRÊT — à confirmer avant le départ.',
    r.specialInstructions ? `\nInstructions particulières : ${r.specialInstructions}` : '',
  ];

  const en: string[] = [
    'Hello,',
    '',
    `Driver request — ${r.storeName}`,
    '',
    `Vehicle: ${r.vehicle}`,
    `Delivery date: ${r.deliveryDate}`,
    r.pickupAddress ? `Pickup address: ${r.pickupAddress}` : 'Pickup address: to be confirmed',
    r.deliveryAddress ? `Delivery address: ${r.deliveryAddress}` : 'Delivery address: to be confirmed',
    '',
    `Drivers needed: ${r.driversNeeded}`,
    r.hasTradeIn
      ? '  (trade-in to bring back — the driver returns in the trade)'
      : '  (no trade-in — a second driver follows and brings the first one home)',
    r.plateNumber ? `Dealer plate: ${r.plateNumber}` : '',
    r.chaserName ? `Chaser vehicle: ${r.chaserName}` : '',
    '',
    r.cashToCollectCents > 0 ? `CASH TO COLLECT: ${money(r.cashToCollectCents, 'en-CA')}` : 'No cash to collect.',
    r.wetInkReady ? 'Signed file: ready.' : 'Signed file: NOT READY YET — confirm before leaving.',
    r.specialInstructions ? `\nSpecial instructions: ${r.specialInstructions}` : '',
  ];

  return {
    to: r.to,
    subject: `Demande de chauffeur / Driver request — ${r.vehicle} — ${r.deliveryDate}`,
    text: [...fr.filter((l) => l !== ''), '', '— — —', '', ...en.filter((l) => l !== '')].join('\n'),
  };
}

export interface CustomerEtaNotice {
  to: string;
  /** The customer's own language — not a bilingual wall (Bill 96 §; D-002). */
  locale: 'fr-CA' | 'en-CA';
  customerName: string | null;
  vehicle: string;
  storeName: string;
  /** Already formatted in the customer's locale by the caller. */
  etaArrival: string | null;
  driverName: string | null;
  storePhone: string | null;
}

/**
 * F-11c: telling the customer their car is on the way.
 *
 * In ONE language, theirs. The driver request is bilingual because a dispatch
 * company serves both markets from one inbox; a customer has a stated
 * preference and sending them two copies of the same paragraph reads as a form
 * letter. Quebec French is the default when nothing is stated.
 *
 * No link, no attachment, no tracking pixel: this is a courtesy message about a
 * car and a time, and anything else in it would be a reason for a customer to
 * distrust the next one.
 */
export function customerEtaMessage(n: CustomerEtaNotice): EmailMessage {
  const fr = [
    n.customerName ? `Bonjour ${n.customerName},` : 'Bonjour,',
    '',
    `Votre véhicule est en route : ${n.vehicle}`,
    n.etaArrival ? `Heure d'arrivée prévue : ${n.etaArrival}` : 'Nous vous confirmerons l’heure d’arrivée sous peu.',
    n.driverName ? `Chauffeur : ${n.driverName}` : '',
    '',
    `Une question ? Répondez à ce courriel${n.storePhone ? ` ou appelez-nous au ${n.storePhone}` : ''}.`,
    '',
    n.storeName,
  ];
  const en = [
    n.customerName ? `Hello ${n.customerName},` : 'Hello,',
    '',
    `Your vehicle is on its way: ${n.vehicle}`,
    n.etaArrival ? `Estimated arrival: ${n.etaArrival}` : 'We will confirm the arrival time shortly.',
    n.driverName ? `Driver: ${n.driverName}` : '',
    '',
    `Questions? Reply to this email${n.storePhone ? ` or call us at ${n.storePhone}` : ''}.`,
    '',
    n.storeName,
  ];
  const body = n.locale === 'en-CA' ? en : fr;
  return {
    to: n.to,
    subject:
      n.locale === 'en-CA'
        ? `Your vehicle is on its way — ${n.vehicle}`
        : `Votre véhicule est en route — ${n.vehicle}`,
    text: body.filter((l) => l !== '').join('\n'),
  };
}
