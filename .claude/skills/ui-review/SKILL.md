---
name: ui-review
description: Review UI work for accessibility (WCAG 2.2 AA), responsive behavior, performance, form UX, and usability heuristics. Use after building or restyling pages/components/flows, before releases of user-facing features, or when the user says "review the UI", "accessibility check", "a11y", or "UX review".
---

# UI Review

Target: **WCAG 2.2 AA** — a safe superset of the EU EAA's current legal baseline
(EN 301 549, which maps to WCAG 2.1 AA; the 2.2-based update is expected to
supersede it, so building to 2.2 covers both).
Automated scanners catch at most ~30–50% of issues — this review is code-reading plus
actually driving the UI (use browser tooling / the project's e2e setup if available;
run axe-core where wired in, but never report "accessible" from a scan alone).

## 1. Semantics & structure

- Native elements before ARIA: `button`, `a`, `nav`, `main`, `dialog`, `details`.
  A `div onClick` is a finding.
- Heading levels sequential, one `h1` per page; images have meaningful `alt`
  (or `alt=""` if decorative); page has `lang`.

## 2. Keyboard & focus

- Every interactive element reachable and operable by keyboard; tab order matches
  visual order; no traps; Esc closes overlays and returns focus to the trigger.
- Focus indicator always visible and never fully obscured by sticky headers/footers
  (WCAG 2.4.11).

## 3. WCAG 2.2 specifics (the ones older checklists miss)

- Interactive targets ≥24×24 CSS px hard floor — design to 44–48px (2.5.8).
- Every drag interaction has a click/tap alternative (2.5.7).
- Never ask users to re-enter information already provided in-session (3.3.7).
- Login: paste and password managers work; no cognitive puzzles without an
  alternative (3.3.8).
- Do NOT flag criterion 4.1.1 Parsing — it was removed in WCAG 2.2.

## 4. Color & theming

- Contrast: ≥4.5:1 body text, ≥3:1 large text / UI components / focus indicators —
  verified in BOTH light and dark themes (muted text in dark mode is the usual
  failure). No pure `#000` backgrounds or pure `#FFF` long-form text in dark mode.
- Nothing conveyed by color alone (errors, states, chart series).

## 5. Responsive

- Mobile-first; verify at 320px width and 200% zoom — no horizontal page scroll,
  nothing cut off.
- Container queries for component layout, media queries for page layout.
- Full-height sections use `100svh` (with `100vh` fallback line above), not bare `100vh`.
- Fluid type via `clamp()` includes a rem term (bare `vw` breaks zoom); body text ≥1rem.

## 6. Motion & performance

- Non-essential animation only inside `@media (prefers-reduced-motion: no-preference)`;
  nothing auto-plays >5s without a pause control.
- Budget at p75 real-user: LCP ≤2.5s, INP ≤200ms, CLS ≤0.1. Check the usual INP/CLS
  suspects: long main-thread tasks on interaction, images without dimensions, layout
  shifts from late-loading content, unoptimized hero images.

## 7. Forms

- Single column; persistent visible `<label>` per field (placeholder-only labels are
  a finding); correct `type`/`inputmode`/`autocomplete`; optional fields marked.
- Inline validation on blur; errors tied to fields (`aria-describedby` +
  `aria-invalid`), announced, in text + icon — never color alone.

## 8. Usability heuristics (Nielsen)

Walk the changed flows against: visibility of system status (loading/success
feedback), user control (undo/cancel), consistency, error prevention (confirm
destructive actions), recognition over recall, minimalist design, helpful error
recovery ("what do I do now?" answered).

## Report

Findings ordered by severity (blocker / major / minor) with `file:line` or
screen+step, the WCAG criterion or heuristic violated, and a concrete fix.
State explicitly what was checked by running the UI vs by reading code only.
