#!/usr/bin/env node
/**
 * F-82a (D-083) — prints the SHA-256 digest of each name read on stdin, one
 * per line, so the real-name guard (apps/api/src/real-name-leak.test.ts) can
 * ban a name without the repository ever carrying it in plaintext.
 *
 * Input: one phrase per line — a surname on its own, or a full name for the
 * ones that would collide with a common given name. Each line is tokenised
 * EXACTLY as the guard tokenises a file (/[A-Za-z][A-Za-z'-]{2,}/g, lower-
 * cased, a possessive 's and edge apostrophes / hyphens trimmed, then every
 * remaining hyphen removed so a compound surname hashes the same with or
 * without its hyphen) and the tokens are joined with single spaces, so the
 * digest printed here is the digest the guard computes when it meets the
 * same name in a file. The guard's lockstep test feeds this script its own
 * sentinel and expects its own digest back — the two normalisers cannot
 * drift apart unnoticed.
 *
 * Usage:  printf 'Surname\nGiven Surname\n' | node scripts/hash-banned-names.mjs
 * Output: one hex digest per non-empty input line, in input order. Nothing
 * else is printed — the names never leave stdin, and this script must never
 * be given a file that lives in the repository as its input.
 */
import { createHash } from 'node:crypto';

const TOKEN = /[A-Za-z][A-Za-z'-]{2,}/g;

/**
 * Lower-case, drop a possessive 's and any trailing apostrophe / hyphen, then
 * every remaining hyphen — identical to the guard's normalise().
 */
function normalise(raw) {
  const t = raw
    .toLowerCase()
    .replace(/'s$/, '')
    .replace(/['-]+$/, '')
    .replace(/-/g, '');
  return t.length >= 3 ? t : null;
}

function digest(phrase) {
  const tokens = [];
  for (const m of phrase.matchAll(TOKEN)) {
    const t = normalise(m[0]);
    if (t) tokens.push(t);
  }
  if (tokens.length === 0) return null;
  return createHash('sha256').update(tokens.join(' ')).digest('hex');
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  const out = [];
  for (const line of input.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const d = digest(line);
    if (d === null) {
      console.error('hash-banned-names: a line produced no token (needs 3+ letters)');
      process.exit(1);
    }
    out.push(d);
  }
  process.stdout.write(out.join('\n') + (out.length ? '\n' : ''));
});
