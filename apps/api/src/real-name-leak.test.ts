import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { hash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join } from 'node:path';

/**
 * F-82a (D-083) — ROADMAP 0.3, « scrub confidential data »: no real employee
 * of the first tenant is named anywhere in this tree.
 *
 * The legacy application's seed carried its twelve-person sales roster WITH
 * each person's pay terms, and the roster spread from there into the plan
 * docs, a spec, a JSX placeholder and one golden test. The scrub replaced
 * every identity with « Vendeur NN » — the money numbers are the executable
 * spec and did not move by a cent — and this guard keeps the names out.
 *
 * It is the mirror image of brand-leak.test.ts. That guard protects the
 * SECOND tenant from the first one's identity in shipped code, so it scans
 * shipped source only; this one protects twelve PEOPLE, so it scans every
 * text file a clone contains — tests, docs, the legacy reference material,
 * scripts, infra, CLAUDE.md, the agent memory under .claude/, the workflow
 * under .github/, the root configs — because a name in a test fixture or in
 * a reviewer agent's notes is exactly as much a name as one in a route. The
 * surface is not a hand-kept directory list: it is `git ls-files` (tracked
 * files plus untracked ones git would add, never what .gitignore excludes),
 * filtered to the extensions a person reads. That is « what a clone
 * contains » by construction, and it keeps the answer independent of the
 * machine: build output and runtime output (dist, coverage, the Playwright
 * report, the local document store) are git-ignored, so they never enter
 * the enumeration and the guard cannot depend on what last ran here.
 *
 * The banned list is SHA-256 digests, never plaintext: a guard that spelled
 * the names would itself be the leak it exists to prevent. An unambiguous
 * surname is banned as a single token; a name that collides with the
 * owner's, with the two agent personas or with a common given name is
 * banned only as its full-name pair, so « Hassan » or « HUSSEIN » on their
 * own never trip it. Honest limit: the digests are unsalted, so someone who
 * already suspects a name can confirm it by hashing — the goal is « not in
 * the working tree, not grep-able », not secrecy against a guess. The
 * digests come from scripts/hash-banned-names.mjs (names on stdin, digests
 * on stdout — the names never touch a file) and are kept sorted, so their
 * order says nothing about the roster's.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Text a person reads; images, archives and incremental build state are not. */
const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.md',
  '.sql',
  '.json',
  '.jsonl',
  '.yml',
  '.yaml',
  '.css',
  '.html',
  '.txt',
  '.csv',
  '.sh',
  '.example',
  '',
]);

/**
 * Files that must be in the enumeration on every run — one per kind of
 * place a name could come back to (the root, a dot-directory, the guard
 * itself, the test that carried the roster, the reference doc that carried
 * the pay-plan tables) — so an enumeration that silently returned a fragment
 * of the tree is red, not green.
 */
const ANCHORS = [
  'README.md',
  'CLAUDE.md',
  '.github/workflows/ci.yml',
  'apps/api/src/real-name-leak.test.ts',
  'packages/core/src/money-math.test.ts',
  'reference/kia-tracker-specs/docs/new/01-business-logic/commissions-clawbacks.md',
];

/**
 * Every text file a clone contains, as repo-relative forward-slash paths:
 * the index plus untracked-not-ignored files (so a file written this
 * session is scanned before it is ever `git add`ed). Without a git
 * repository the guard cannot know the surface and throws — red, not a
 * silent empty scan.
 */
function enumerate(): string[] {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .split('\0')
    .filter((p) => p !== '' && TEXT_EXTENSIONS.has(extname(p)));
}

/**
 * The tokeniser scripts/hash-banned-names.mjs uses too: a word of three or
 * more letters, apostrophes and hyphens allowed inside it (Jean-Pierre, O'Neil).
 */
const TOKEN = /[A-Za-z][A-Za-z'-]{2,}/g;

/**
 * A token as it is hashed: lower-cased, a possessive 's and any trailing
 * apostrophe / hyphen dropped, then every remaining hyphen removed — so
 * `'Surname'` inside a seed string, `Surname's` in prose and `Surname` in a
 * table hash to one digest, and a compound surname hashes the same whether
 * a table-reformatter kept its hyphen or dropped it (« Al-X » and « AlX »
 * are one token). A hyphen written as a space or a period splits the word
 * instead; the body of the roster's one hyphenated surname is therefore
 * banned on its own as well.
 */
function normalise(raw: string): string | null {
  const t = raw
    .toLowerCase()
    .replace(/'s$/, '')
    .replace(/['-]+$/, '')
    .replace(/-/g, '');
  return t.length >= 3 ? t : null;
}

const digests = new Map<string, string>();
function digest(phrase: string): string {
  let d = digests.get(phrase);
  if (d === undefined) {
    d = hash('sha256', phrase, 'hex'); // one-shot: Node >= 21.7, and engines pins >= 24
    digests.set(phrase, d);
  }
  return d;
}

/**
 * Seventeen digests: fifteen for the roster — seven single tokens (six
 * surnames, and the body of the one hyphenated surname so that its hyphen
 * written as a space or a period still trips it) and eight full-name pairs
 * (the three-token name as three pairs: given + middle, middle + surname,
 * and given + surname with the middle name dropped, the ordinary way to
 * write a person) — and two for the sentinels below, which prove on every
 * run that the set is consulted. Regenerate with
 * scripts/hash-banned-names.mjs; keep the list sorted.
 */
const BANNED = new Set([
  '114c0c4a440586496dfcbee89d5e092520bd93e3ff9da85626d213fb2225caef',
  '30ba0954b1f6d0e1badb464d4c8fda07742311eb6383a68a6dd2bd73204cf679',
  '3178337f84c2b0336a2ac12233e011b40dc003dd84874c21c2710d5c88eb2db7',
  '35ba48b9b1a1e15bd364237a462fc5d285ec0109cfc1d61c83cc5591ea7d8c4e',
  '3b8e6dcad2512ea7a15727236f732bac7c58f43d204b8579d5bcc13bbe3ee6b7',
  '40f4800c3ff7e0670f0a44f40e56247becf9987590edc5adf2df758e8d95c889',
  '65aaf54a2a0d3497165e343dc4d08e74011c8a2646091cd92b07449c30433a62',
  '6d75c599682b3e71673a183711eeb0eb47befd1993f0af60f35be7576478478c',
  'a7030ff98e1dad2d9c5e3704a10e1f5bc9c5eb494910abafc4b48e94db3ee28b',
  'b535917577618dbcfb3449e10d558294e8c4a846b3825a984e3e30912927ef6a',
  'bdbaa86bdfd03b5ee3b1be083a9c1fb2b6624086f3fd9697dbb14261198bfd8e',
  'c1cadc2b4dba76b100021d8d7b353f493d8112279b38f1ef8768205c95c9bc1a',
  'cc394a4c9380b00bf48d23c929670945fe519156fcc423de56a0035abcfb842c',
  'd880547206588c5bc22ab7010d5e4bd0b3ba8ad03406b803358d9bc39a025de5',
  'e5d9838bd23d6e8a25653e27243f9b165a99bc5ac30ebbae6b1739cd2be00116',
  'e949a00c7886cd71be95b301d59d5313e07340765a7f89175eb77703d92c3327',
  'fcf8493b54f484c07db905f5831be2a0bd4d24c2fc694bfa39f614ad06a02800',
]);

/**
 * The sentinels, spelled backwards in the source so that this file — which
 * the guard scans like any other — does not trip on them. The forward
 * spelling exists only in memory, inside the positive tests. Their digests
 * are hard-coded in BANNED above rather than computed here, so a change to
 * the algorithm or the normaliser turns the positive test red instead of
 * silently emptying the guard.
 */
const rev = (s: string): string => s.split('').reverse().join('');
const SENTINEL_TOKEN = rev('lenitnes-emanlaer');
const SENTINEL_PAIR = `${rev('lenitnes')} ${rev('margib-emanlaer')}`;

type Offence = { line: number; column: number; characters: number; digest: string };

/** Every banned token, and every banned adjacent pair, in a text. */
function scan(text: string): Offence[] {
  const tokens: { norm: string; line: number; column: number; characters: number }[] = [];
  text.split('\n').forEach((lineText, i) => {
    for (const m of lineText.matchAll(TOKEN)) {
      const norm = normalise(m[0]);
      if (norm) tokens.push({ norm, line: i + 1, column: (m.index ?? 0) + 1, characters: m[0].length });
    }
  });
  const offences: Offence[] = [];
  tokens.forEach((t, i) => {
    const one = digest(t.norm);
    if (BANNED.has(one)) offences.push({ line: t.line, column: t.column, characters: t.characters, digest: one });
    // Pairs are taken over the token stream, not the line, so a name broken
    // across a line end (a wrapped table cell, a soft-wrapped paragraph) is
    // still one name.
    const next = tokens[i + 1];
    if (next) {
      const two = digest(`${t.norm} ${next.norm}`);
      if (BANNED.has(two)) {
        offences.push({ line: t.line, column: t.column, characters: t.characters + 1 + next.characters, digest: two });
      }
    }
  });
  return offences;
}

it('flags a banned token, and a banned adjacent pair, in a document it is handed', () => {
  // A test that only asserts absence confirms the break: this one proves the
  // tokenise → normalise → digest → lookup path is live on every run.
  expect(scan(`Le plan de ${SENTINEL_TOKEN} : 25 %, pad 1 500 $.`)).toEqual([
    { line: 1, column: 12, characters: SENTINEL_TOKEN.length, digest: digest(normalise(SENTINEL_TOKEN) ?? '') },
  ]);
  expect(scan(`| ${SENTINEL_PAIR} | 30% | yes |`)).toEqual([
    {
      line: 1,
      column: 3,
      characters: SENTINEL_PAIR.length,
      digest: digest(SENTINEL_PAIR.split(' ').map(normalise).join(' ')),
    },
  ]);
  // The seed-string and possessive spellings hash to the same digest.
  expect(scan(`('${SENTINEL_TOKEN}', 0.25)`)).toHaveLength(1);
  expect(scan(`${SENTINEL_TOKEN}'s deals`)).toHaveLength(1);
  // So does the hyphenated token with its hyphen dropped.
  expect(SENTINEL_TOKEN).toContain('-');
  expect(scan(SENTINEL_TOKEN.replace('-', ''))).toHaveLength(1);
  // A pair split across a line end is still one name.
  expect(scan(SENTINEL_PAIR.replace(' ', '\n'))).toHaveLength(1);
  // Each half of the pair on its own is not banned (punctuation is not a
  // token, so a word must stand between them — a dash would not).
  expect(scan(SENTINEL_PAIR.split(' ').join(' alone, then '))).toEqual([]);
});

it('does not ban the owner, the organisation or the agent personas', () => {
  expect(
    scan('Hassan — Groupe Hassan — HUSSEIN and AHMAD build in parallel; Vendeur 03 and Vendeur 07.'),
  ).toEqual([]);
});

it('scripts/hash-banned-names.mjs digests a name exactly as this guard does', () => {
  const script = join(repoRoot, 'scripts', 'hash-banned-names.mjs');
  const out = execFileSync(process.execPath, [script], {
    input: `${SENTINEL_TOKEN}\n('${SENTINEL_PAIR}',\n`,
    encoding: 'utf8',
  });
  const tokenDigest = digest(normalise(SENTINEL_TOKEN) ?? '');
  const pairDigest = digest(SENTINEL_PAIR.split(' ').map(normalise).join(' '));
  expect(out.trim().split(/\r?\n/)).toEqual([tokenDigest, pairDigest]);
  expect(BANNED.has(tokenDigest)).toBe(true);
  expect(BANNED.has(pairDigest)).toBe(true);
});

// An explicit ceiling: the scan is ~3 s on its own and passed 5 s with a build
// running beside it — vitest's default 5 s testTimeout turned a busy machine
// into a red guard on the very first run, with no name anywhere.
it('no real employee is named anywhere in the tree (ROADMAP 0.3, D-083)', async () => {
  const files = enumerate();
  // The enumeration must have reached the tree: ~1,100 files today, and the
  // anchors prove the root, a dot-directory, this file, the test that carried
  // the roster and the reference doc that carried the pay plans are all in
  // it. A guard that can pass with zero coverage is indistinguishable from a
  // working one in CI; this one cannot.
  expect(files.length).toBeGreaterThan(500);
  expect(files).toEqual(expect.arrayContaining(ANCHORS));

  // ~1,100 files: opened one after another they cost seconds on a Windows
  // machine with a real-time scanner (measured 6 s warm, 39 s cold); opened
  // together they cost tens of milliseconds. The hashing is ~2 s either way.
  // A path the index still lists but the working tree no longer has (an
  // unstaged deletion) contains nothing to scan.
  const sources = await Promise.all(
    files.map((file) =>
      readFile(join(repoRoot, file), 'utf8').catch((e: NodeJS.ErrnoException) => {
        if (e.code === 'ENOENT') return '';
        throw e;
      }),
    ),
  );

  const offences: string[] = [];
  files.forEach((file, i) => {
    for (const o of scan(sources[i] ?? '')) {
      // The offending text is deliberately not quoted: this guard's own
      // output must never put a name into a CI log.
      offences.push(
        `${file}:${o.line}:${o.column} — a banned real name (${o.characters} characters, sha256 ${o.digest.slice(0, 12)}…)`,
      );
    }
  });

  expect(
    offences,
    `a real person is named in the tree — replace the identity with « Vendeur NN » (D-083) and leave every number beside it untouched:\n${offences.join('\n')}`,
  ).toEqual([]);
}, 60_000);
