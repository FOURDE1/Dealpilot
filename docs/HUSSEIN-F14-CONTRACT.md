# F-14 — white-label branding: what the API gives you

Merged to `develop` (7ee6262), CI green, 528/528. Additive; nothing you have
breaks.

This is the server half of Phase 2's white-label. **The CSS-variable injection,
the theme editor and the live preview are yours** — I have deliberately not
touched them. What follows is the data and the guarantees behind it.

## Endpoints

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/api/v1/branding` | — | `PublishedBranding` **or `null`** |
| GET | `/api/v1/organizations/:id/branding` | — | `TenantBranding` (the draft) |
| PUT | `/api/v1/organizations/:id/branding` | `UpdateBrandingInput` | 200 `TenantBranding` |
| POST | `/api/v1/organizations/:id/branding/publish` | `{}` | 200 `TenantBranding` |

`GET /api/v1/branding` is the one the app boots on. **Any member may read it** —
gating it behind a settings permission would render the app unbranded for
everyone except the owner. The editor endpoints need `organization:update`.

## The three things that will shape your code

**1. `null` is a normal answer.** A tenant who has never opened the editor gets
`null`, not a 404. Use the platform's own default theme and carry on — a 404
here would break first paint for every tenant on day one.

**2. You get a frozen SNAPSHOT, never the draft.** The published payload is a
point-in-time copy of name, asset keys, font, radius, density, dark-mode
strategy and the computed palette. Two consequences:

- Editing a published brand does **not** change what `/api/v1/branding` serves.
  The app keeps the last published look until someone presses publish. Somebody
  trying colours at 4pm on a Friday does not repaint the floor — and equally,
  opening the editor does not strip the branding.
- A half-finished rename in the draft never reaches a browser.

**3. `version` is your cache key.** It increments on every publish. Nothing else
about the payload is guaranteed to change — two publishes of the same colours
produce the same palette by design.

## The palette

```jsonc
{
  "fills":       { "primary": "oklch(0.87 0.17 95)" },   // exactly what they picked
  "text":        { "primary": "oklch(0.52 0.17 95)",      // readable on light
                   "primary_dark": "oklch(0.77 0.14 95)" },// readable on dark
  "foregrounds": { "primary": "oklch(0.145 0 0)" },       // label ON the fill
  "dark":        { "primary": "oklch(0.85 0.14 95)" }     // §5 derived dark
}
```

**Use `fills` for backgrounds and `text` for text. They are different on
purpose** — a brand colour can be perfect on a button and unreadable as a link
on white, and §12 draws exactly that line. `foregrounds[token]` is what a label
sitting on top of `fills[token]` must be.

Every value in `text` is guaranteed ≥ 4.5:1 against the surface it is named for,
and every `foregrounds` value ≥ 4.5:1 against its fill. That guarantee is
computed server-side and stored, so it holds no matter what the client does.

Tokens present: `primary` always; `accent`, `success`, `warning`, `danger`,
`info` only if the tenant set them. **Do not invent a missing token** — fall
back to the platform default.

## Contrast is auto-fixed, never refused

A tenant can pick pale yellow. It publishes. The fill stays their yellow and the
text variant is darkened until it is readable — hue and chroma preserved, only
lightness moves, so it still reads as their colour.

`contrast_adjustments` on the draft response lists every change with
`ratioBefore` / `ratioAfter` / `reason`. §11 asks the editor to show these
inline as the user types ("Contrast 2.9:1 — will be auto-adjusted to meet WCAG
AA") and to list them on the publish confirmation. The numbers are there for
exactly that.

Colour maths you may need client-side is exported from `@dealpilot/core`:
`parseColor`, `formatOklch`, `oklchToHex`, `contrastRatio`, `readableOn`,
`deriveDark`, `validateBrandingContrast`, `AA_TEXT`, `AA_UI`. Use these rather
than a new implementation — the editor's live preview and the server's publish
must not disagree about what is readable.

## Input rules

- Colours accept **hex or `oklch(L C H)`**; storage is always OKLCH. Anything
  else is 422 — a silently-defaulted colour is a brand nobody chose.
- ~~`font_family: 'custom'` requires `font_woff2_key`, else 422.~~ **Retired
  2026-08-31 (F-75, migration 0070, D-076).** `custom` is no longer a font and
  `font_woff2_key` / `font_woff2_bold_key` are no longer fields: both PUTs are
  now 422 — the enum refuses the value and `strictObject` refuses the unknown
  key. `font_family` is `inter | system`.
- An empty PUT body is 422.
- Asset fields are **keys, not URLs** (`logo_light_key`, `favicon_key`, …), filled
  by the upload endpoint documented at the end of this file.

## Not built yet

**Custom domains and billing.** Phase 2's other two workstreams need paid
AWS/Stripe; the standing instruction is that no paid resource is provisioned
during the build.

## One thing to avoid

`POST /api/v1/members` is a live endpoint that creates a membership whose
identity is not linked to any sign-in account — anyone added that way is
`active` and can see nothing (CR-14). **You already use `invitations.create`,
which is correct.** Please keep it that way; I will close the other door once
the owner decides D-040.

---

## Brand assets — now built (same commit series)

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| POST | `/api/v1/organizations/:id/branding/assets/:slot` | **raw bytes** | 201 `TenantBranding` |
| GET | `/api/v1/branding/assets/:slot` | — | 200 the bytes |

Slots: `logo_light`, `logo_dark`, `favicon`, `email_logo`, `login_bg`.
Content types: `image/png`, `image/jpeg`, `image/svg+xml` — **not** the document
allowlist, deliberately: a signed contract must never be an SVG and a logo must
never be a PDF.

Per-slot ceilings (413 with the limit named): logo 200 KB, favicon 100 KB, email
logo 300 KB, login background 1 MB.

**`email_logo` and `login_bg` refuse SVG** (415 `raster_required`). Email clients
render SVG unreliably or not at all — it would look right in your editor and be
missing from every email the dealership sends.

**Uploading an asset is an edit**: it puts the brand back to `draft`, so a new
logo does not appear on the floor until publish, exactly like a colour. The GET
serves from the **published snapshot**, so an unpublished logo is a 404.

### One security rule I need you to hold

Render brand assets with **`<img src="…">`**. Never fetch the SVG and inline it
into the DOM.

The serving route sets `Content-Security-Policy: default-src 'none'; sandbox`,
`X-Content-Type-Options: nosniff` and the exact content type — an SVG is a
document that can carry script, and a tenant-supplied logo that could run script
is a stored XSS in every tenant's header. Those headers protect the asset as a
*resource*; inlining it into your page bypasses all of them.

Keys are content-addressed, so the bytes at a key never change and the response
is cached `immutable` for a year. A new logo is a new key — you never need to
bust it.

### Still not built

Image **dimension** validation and EXIF stripping (§2 wants max 512×160 for the
logo, and EXIF stripped from the login background). Both need an image library —
`sharp` — which is a new dependency and therefore the owner's call, not mine.
Today the size ceiling and the content-type allowlist are the whole check.

---

## Rooftop sub-brands — the scope is a query parameter

A group can brand itself once, or give an individual rooftop its own sub-brand
(§3). Every editor endpoint takes an optional `?store_id=`:

| Scope | Call |
| --- | --- |
| The group brand | `PUT /api/v1/organizations/:id/branding` |
| One rooftop | `PUT /api/v1/organizations/:id/branding?store_id=…` |

Same for `GET`, `publish` and asset upload. Reading is
`GET /api/v1/branding?store_id=…`, which the app should always pass when the
user has a store selected.

**Resolution is store-first, then group.** A rooftop with its own brand gets it;
every other rooftop inherits the group's. A store with no override is never a
404 and never sees a different rooftop's brand.

The two drafts are separate rows with separate publish states: publishing a
rooftop's brand does not touch the group's, and vice versa.

**`store_id` is NOT in the request body** — it was, briefly, and I removed it.
A `store_id` sitting in a payload beside a set of colours is a way to move a
brand to a different rooftop by accident. The scope belongs in the URL.

Why this note exists: the table and the resolution query supported store
overrides from the first commit, and the editor routes hardcoded the group row —
so a rooftop brand could be created and then never edited or published. Half
reachable is worse than absent; it is fixed and tested now.

---

## Known gap: the branded LOGIN page cannot be branded yet

Every branding endpoint requires a session (deny-by-default, app.ts
`PUBLIC_ROUTES`). So a visitor who has not signed in cannot fetch the tenant's
logo or login background — **do not build the login page expecting branding to
be available there.** It will 401.

This is not an oversight I can close on my own. To brand a login page the server
has to know *which tenant* before anyone has authenticated, and §3 resolves that
from the custom domain or the `{dealer}.dealpilot.app` subdomain — which is the
custom-domain workstream, and needs paid AWS (ACM + CloudFront), which the owner
has not authorised during the build.

The alternative is resolving the tenant from something in the URL the visitor
types, e.g. `/login?org=groupe-hassan`. That works without any infrastructure,
but it makes a tenant's existence and their logo readable by anyone who guesses
a slug. Small, but it is a disclosure decision and therefore the owner's, not
mine. Filed as **D-041**.

Until one of those lands: the login page uses the platform's own default look,
and branding begins at first paint after sign-in.

---

## CR-15 closed — the palette now has everything the injection needs

_2026-08-31 (F-75, D-076): the injection landed. `fills`/`foregrounds`/`hover`/`ring`
are painted as units, the SPA re-proves `text.primary(_dark)`, `ring.primary(_dark)`
and `ring.danger(_dark)` against its own surfaces before emitting them, and
`dark_mode='custom'` / `font_family='custom'` (+ the two WOFF keys) were retired by
migration 0070 — `PublishedBranding` no longer carries them._

You were right on both counts, and the numbers made it quick. Fixed:

**`foregrounds` is now keyed per FILL, including the dark ones.**

| Fill | Its label |
| --- | --- |
| `fills.primary` | `foregrounds.primary` |
| `dark.primary` | `foregrounds.primary_dark` |
| `hover.primary` | `foregrounds.primary_hover` |
| `hover.primary_dark` | `foregrounds.primary_hover_dark` |

`primary` and `primary_dark` are frequently **opposite** — the dark palette
lightens a brand colour, so a medium-dark brand takes a white label in light mode
and a near-black one in dark mode. That is exactly the 2.5:1 you measured.

**`hover.*` is a new FILL map**, not a text tone. Nudged in L, with its own
guaranteed foreground. The direction is chosen for legibility rather than
convention: your `#7C3AED` lightened by the conventional step lands at 4.46:1,
so it darkens instead. It is always visibly different from the base — a hover
that equals the base is the bug you described.

**`ring.*` is new too** — a focus ring meeting **3:1** against its surface
(`ring.primary` on light, `ring.primary_dark` on dark). 3:1 not 4.5:1 because
WCAG 2.2 holds UI components to a different floor than text; demanding 4.5 would
push every ring toward black and lose the brand for no gain. This also closes
§12's focus-ring row, which I had left unimplemented — `AA_UI` was exported from
`packages/core` and used by nothing, which is the same dead-vocabulary shape the
guards in this repo hunt.

### The test that was missing

My suite asserted `foregrounds.primary` against `fills.primary` and stopped —
so `dark.primary`, the thing the app actually paints in dark mode, had no
assertion at all. There is now a **whole-palette invariant**: it walks every
fill in the payload and asserts its declared foreground meets AA, in both the
unit tests and end-to-end against what the API really returns. It caught the
`#7C3AED` hover case on its first run.

### Still your call, and I agree with your reading

`fills.*` is deliberately un-adjusted and can be pale, so it is **not** safe for
anything with a contrast floor — use `fills` for backgrounds only, `text` for
text, and the matching `foregrounds` entry for a label sitting on a fill. The
`--primary` role-split on the app side (fills → `bg-*`, text → links) is yours
and I think it is the right shape.

550/550.

---

## Fixed at the source: `GET /api/v1/branding` no longer 404s for an org-less user

You worked around this client-side in increment 2 — 404 → platform theme,
`retry: false`. The workaround is good defensive practice and worth keeping, but
the endpoint was wrong and it is fixed now.

**A user who belongs to no organisation gets `200` with a `null` body**, the same
as an organisation that has never been branded. "What should this app look like"
is a question with an answer for everyone; the 404 conflated "you have no
organisation" with "not found", and a client can only read that as an error —
which is exactly what happened: react-query retried it, the shell re-rendered
repeatedly, and it raced your skip-link test.

Belonging to several organisations without naming one also returns `null` now,
for the same reason.

**What did NOT change:** naming someone else's `organization_id` is still a
**404**. Membership is checked inside the tenant transaction, not by whether the
caller could type an id — there is a test asserting exactly that, so the
permissive answer above cannot become a way in.

You can drop the 404 branch whenever it suits you; `retry: false` on a branding
read is worth keeping regardless.

---

## CR-16 closed — and the drift it would have caused

`GET /organizations/:id/branding` now returns **`200` with `null`** for an
organisation (or a rooftop) that has never been branded, instead of 404. "Load
the draft" always resolves, same as the published read.

A foreign or unknown organisation is **still a 404** — the permission check runs
before the row lookup, so the friendlier answer cannot be used to probe for
organisations. There is a test asserting exactly that.

### The part you did not ask for but needed

Your fallback renders the platform defaults when there is no draft. Those values
also live as column DEFAULTs in the migration, applied the moment the first save
creates the row. Two copies of the same thing, and if they ever drifted **the
editor would open on one colour and save a different one** — which looks like
the form ignoring the user, and no amount of staring at the form would explain it.

So they are one source now: **`BRANDING_DEFAULTS`, exported from
`@dealpilot/schemas`.** Use it for the null case instead of literals:

```ts
const draft = data ?? BRANDING_DEFAULTS;
```

`branding-defaults.test.ts` reads the column defaults out of the database
catalogue and asserts they match that object — mutation-proven, so changing
either side alone fails CI with the two values printed side by side.

It covers `primary_color`, the four semantic colours, `font_family`, `radius`,
`density`, `dark_mode` and `ai_persona_name`. Anything else your form needs a
starting value for, tell me and I will add it there rather than have you keep a
literal.

567/567.
