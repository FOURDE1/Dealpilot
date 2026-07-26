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
- `font_family: 'custom'` requires `font_woff2_key`, else 422. A custom font
  with no file falls back silently and the tenant thinks their brand shipped.
- An empty PUT body is 422.
- Asset fields are **keys, not URLs** (`logo_light_key`, `favicon_key`, …). The
  upload endpoint that fills them is not built yet — see below.

## Not built yet

**Asset upload.** The columns and the contract are there; there is no endpoint
to put bytes behind them. It will reuse F-13c's storage driver, so the shape
will be the same raw-bytes POST you already use for documents. Until then, a
tenant can brand by colour, name, font, radius and density, but not by logo.

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
