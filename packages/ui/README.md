# @dealpilot/ui

Design system for the 1Dealer platform: the **Nordique** design tokens locked by
**D-024** (docs/DECISIONS.md), Tailwind CSS v4 wiring, and the shadcn-style
component library. Everything visual lives here (ADR-001/017); no app imports a
UI primitive from anywhere else.

## Token architecture (ui-design-system §2)

Three CSS-custom-property layers, all generated from one source:

```
src/theme/tokens.ts          ← source of truth (D-024 values, typed)
        │  build (scripts/generate-css.mjs)
        ▼
dist/tokens.css              ← primitive → semantic → component layers
                               + @theme inline mapping for Tailwind v4
```

- **Primitive** (`--blue-600`, `--neutral-dark-card`, `--status-success`…):
  static reference ramps. Never referenced by components.
- **Semantic** (`--background`, `--primary`, `--destructive`, `--ring`,
  `--sidebar-*`, `--chart-1..5`…): shadcn variable names, so vendored
  components consume tokens untouched. **Components reference this layer
  only** — a raw hex or Tailwind palette class (`bg-blue-600`) in a component
  is a release blocker (ADR-018), and the Button tests assert it.
- **Component** (`--sidebar-width`, `--row-h`, `--transition-fast`…): layout
  and motion constants (§5, §11).

### Consuming the tokens (apps)

```css
/* app CSS entry */
@import 'tailwindcss';
@import '@dealpilot/ui/tokens.css';
```

- `tokens.css` contains an `@source './';` directive, so Tailwind also scans
  this package's shipped JS — utilities used by library components (e.g. the
  Button's `bg-primary`) are generated in the app build without extra config.
- **Dark mode:** set `data-theme="dark"` on `<html>` (or any subtree). The
  `dark:` variant and all semantic tokens follow (white-labeling §4).
- **Form fields:** `--input` is the field **border** (stock shadcn semantic);
  the field fill is the extension token `--input-bg`. Write
  `border-input bg-input-bg`.
- **Status as text:** never use `text-success`/`text-warning` for inline text —
  use the AA-verified `text-success-text` / `text-warning-text` /
  `text-danger-text` / `text-info-text` variants (D-024).
- **Motion:** `duration-fast/normal/slow` utilities map to the §11 motion
  tokens (150/250/350 ms).
- **Density:** `data-density="compact"` swaps the row-height/cell-padding
  tokens (§5). Touch-target minimums are unaffected.
- Tenant branding overrides semantic tokens at runtime (ADR-018) — this
  package ships the *platform default* theme only.

### Key contrast facts (verified by `src/theme/contrast.test.ts`)

The WCAG gate runs in `pnpm test`: every text-bearing token pairing must hold
**AA ≥ 4.5:1 in both themes**; interactive/non-text pairs hold ≥ 3:1.
Notable assignments the gate enforces (D-024):

| Token | Light | Dark |
| --- | --- | --- |
| `primary` / `primary-hover` | blue-600 `#2563EB` (white text 5.17:1) / blue-700 (6.70:1) | blue-400 `#60A5FA` (near-black text 6.64:1) / blue-300 (9.36:1) |
| `destructive` / `destructive-hover` | red-600 `#DC2626` (white 4.83:1) / red-700 (6.47:1) | `#F87171` / `#FCA5A5` (near-black text) |
| `success` | `#10B981` with **near-black** text (6.66:1) | `#34D399` (near-black text) |
| `info` | indigo-600 `#4F46E5` (white text 6.29:1) | `#818CF8` (near-black text) |
| `success/warning/danger/info-text` | `#047857` / `#B45309` / `#B91C1C` / `#4F46E5` — all ≥4.68:1 on page & card | the `*Dark` status colors (≥5.64:1) |
| `ring` | blue-500 `#3B82F6` — accent/non-text only | blue-400 |

blue-500 with white text (3.68:1) and blue-400 with white text (2.54:1) are
forbidden pairings — the tests pin them as failures on purpose. Hover states
swap to darker tokens instead of opacity fades: `hover:opacity-*` on a filled
control is banned (it drops the AA-thin pairings below 4.5:1) and the Button
tests enforce that too. Buttons/inputs carry a 44px min touch target below
`lg` (`max-lg:min-h-11`).

## Scripts

| Command | Does |
| --- | --- |
| `pnpm build` | `tsc` (tests excluded from dist) + generate `dist/tokens.css` via the unit-tested `build-css.ts` |
| `pnpm test` | vitest: WCAG contrast gate + CSS builder + component tests |
| `pnpm demo` | build, then render `dist/demo/index.html` (+ Tailwind CSS) — both themes side by side from the same components |

## Typography & radius (D-024)

Font: **Inter** (300–700), self-hosted WOFF2 by the consuming app (no font
CDN — Law 25). `--font-sans` falls back to `ui-sans-serif, system-ui`.
Radius: `--radius: 0.5rem` with the shadcn `sm/md/lg/xl` derivation.
`tabular-nums` is mandatory on money/number columns (§4).

## Components (H-02 + H-05)

- `Button` (cva variants), `Input` / `Label` / `Select` field primitives.
- `DataTable` — TanStack Table v8 composition: token-styled, sortable,
  loading/error/empty states, wide content scrolls in its own container.
  Client-side ops only (fine <200 rows; server-driven ops land with need).
- `Dialog` / `DialogContent` / `DialogTitle` / `DialogDescription` — themed
  Base UI dialog (compound API re-exported).
- `Form` composition — react-hook-form `FormProvider` + `FormField`/`FormItem`
  /`FormLabel`/`FormControl`/`FormHint`/`FormMessage` with real aria plumbing
  (shared ids, `aria-describedby`, `aria-invalid`, `role="alert"`). Resolvers
  (zod + @dealpilot/schemas) are the caller's `useForm` concern.

## Adding components

Vendored shadcn-style components live in `src/components/` and must: render in
light + dark + both densities, pass the token-only lint/test rules, ship a
test, and appear in the demo page.
