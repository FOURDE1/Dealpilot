#!/usr/bin/env node
/**
 * F-03 helper: send a correctly SIGNED test lead to an intake webhook.
 *
 * The webhook rejects anything without a valid HMAC signature, so this script
 * exists to make the owner test (and any manual QA) possible without hand-
 * computing hashes. It is also the reference implementation an external
 * integrator would copy.
 *
 *   node apps/api/scripts/send-test-lead.mjs --url <webhook_url> --secret <secret> \
 *     [--phone "514 555 0134"] [--first Marie] [--last Tremblay] \
 *     [--email marie@example.com] [--interest "Kia Sportage 2026"] [--lang fr-CA]
 *
 * Both --url and --secret come from the ONE-TIME response when the intake key
 * is created (they are never shown again).
 */
import { createHmac } from 'node:crypto';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const url = arg('url');
const secret = arg('secret');
if (!url || !secret) {
  console.error('Usage: --url <webhook_url> --secret <secret> [--phone ...] [--first ...] [--last ...] [--email ...] [--interest ...] [--lang fr-CA|en-CA]');
  process.exit(2);
}

const payload = {
  phone: arg('phone', '514 555 0134'),
  ...(arg('first') ? { first_name: arg('first') } : {}),
  ...(arg('last') ? { last_name: arg('last') } : {}),
  ...(arg('email') ? { email: arg('email') } : {}),
  ...(arg('interest') ? { vehicle_interest: arg('interest') } : {}),
  ...(arg('lang') ? { preferred_language: arg('lang') } : {}),
};

// The signature covers `${timestamp}.${rawBody}` — sign the EXACT bytes sent.
const body = JSON.stringify(payload);
const timestamp = Math.floor(Date.now() / 1000).toString();
const signature = `v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

const res = await fetch(url, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-intake-timestamp': timestamp,
    'x-intake-signature': signature,
  },
  body,
  signal: AbortSignal.timeout(10_000),
});

const text = await res.text();
console.log(`HTTP ${res.status} ${text}`);
if (res.status !== 202) process.exitCode = 1;
else console.log('Lead accepted — it should now appear in the leads list.');
