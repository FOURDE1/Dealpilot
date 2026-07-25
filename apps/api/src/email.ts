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
}

const SEND_TIMEOUT_MS = 10_000;

export function createMailer(env: Env, logger: FastifyBaseLogger): Mailer {
  if (env.EMAIL_TRANSPORT === 'log') {
    return {
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
