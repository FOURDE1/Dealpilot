/**
 * F-72 — announcements (admin-console.md §8; D-073).
 *
 * Each export below is a rule that two places have to agree on, and each names
 * where that agreement is CHECKED. A rule with one reader belongs at its call
 * site; a rule with two readers and nothing between them is the drift this
 * project keeps finding, so neither is left standing here:
 *
 *  - `ANNOUNCEMENT_SEVERITY_RANK` — the banner's sort in `splitAnnouncements()`
 *    (apps/web) AND the `ORDER BY` inside `announcements_for_user()` (0068),
 *    which runs ahead of that definer's `LIMIT 20` and so decides which
 *    announcements a tenant is ever shown. The SQL `CASE` is read back and
 *    compared against this object by 'announcements_for_user() ranks severity
 *    exactly as ANNOUNCEMENT_SEVERITY_RANK does' in
 *    apps/api/src/platform-drift.test.ts.
 *  - `MARKETING_SUPPRESSED_STATUSES` — `announcement_matches`'s second
 *    `p_status NOT IN (…)` list (0068), which `tenant-lifecycle-drift.test.ts`
 *    asserts against this array, AND the console's "who will not see this"
 *    copy on the compose page, which names the statuses off this array rather
 *    than spelling them into the locale bundles. So a fourth suppressed status
 *    reaches the predicate, the guard and the publisher's warning together.
 *  - `ANNOUNCEMENT_TEXT_FIELDS` / `missingTranslations()` — the compose form's
 *    live both-languages indicator AND, at publish, §8's
 *    `422 MISSING_TRANSLATION`. `PublishAnnouncementInput` (packages/schemas)
 *    cannot import this — schemas carries no dependency on core — so it writes
 *    the four names and the trim rule out again; the two are held equal by
 *    'the publish 422 asks for exactly the fields missingTranslations() marks'
 *    in the same drift file, which parses a blank draft rather than reading
 *    either list.
 *
 * The severity VOCABULARY itself lives in packages/schemas
 * (`ANNOUNCEMENT_SEVERITIES`) and is deliberately not copied here: schemas
 * carries no dependency on core, and two arrays with no assertion between
 * them is the drift this project keeps finding. The rank above is keyed by
 * that vocabulary all the same — the lockstep reads `ANNOUNCEMENT_SEVERITIES`
 * to decide which severity the SQL `ELSE` arm stands for, so a fifth severity
 * that only one side learns about fails there.
 */

/**
 * §8 orders the shell by urgency: an incident outranks planned maintenance,
 * which outranks news, which outranks a promotion. Lower sorts first.
 */
export const ANNOUNCEMENT_SEVERITY_RANK = {
  incident: 0,
  maintenance: 1,
  info: 2,
  marketing: 3,
} as const;

/**
 * §8: "`marketing` severity is suppressed for tenants in `past_due|read_only`."
 *
 * Note what is NOT here: `trial`. A trial tenant is operational
 * (`OPERATIONAL_STATUSES` in ./tenant-lifecycle.ts) and is exactly who a
 * promotion is for. `suspended`, `offboarding` and `purged` receive nothing at
 * all — that is the lifecycle clause, a separate rule.
 */
export const MARKETING_SUPPRESSED_STATUSES = ['past_due', 'read_only'] as const;

/** The four bilingual fields §8 requires at publish, in form order. */
export const ANNOUNCEMENT_TEXT_FIELDS = ['title_en', 'title_fr', 'body_en', 'body_fr'] as const;

export type AnnouncementTextField = (typeof ANNOUNCEMENT_TEXT_FIELDS)[number];

/**
 * Which of the four bilingual fields are still empty. This is the compose
 * form's live indicator; §8's `422 MISSING_TRANSLATION` asks the identical
 * question one layer down and cannot call this (schemas may not import core),
 * so the two answers are held equal by the drift test named in the header
 * rather than by a shared call. Whitespace is not a translation, on both sides.
 */
export function missingTranslations(
  draft: Partial<Record<AnnouncementTextField, string | null | undefined>>,
): AnnouncementTextField[] {
  return ANNOUNCEMENT_TEXT_FIELDS.filter((f) => (draft[f] ?? '').trim().length === 0);
}
