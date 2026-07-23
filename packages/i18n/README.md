# @dealpilot/i18n

Shared FR-first localization for the 1Dealer platform (ADR-019, Bill 96):
`fr-CA` is the default **and** the fallback; `en-CA` must stay key-equivalent.
Consumed by the SPA now; the API/workers use the same factory for emails,
PDFs and SMS later.

## Shape

- `src/locales/fr-CA.ts` — the primary locale, defines the key shape
  (namespaces: `common`, `nav`, `auth`, `dashboard`). ICU message syntax.
- `src/locales/en-CA.ts` — mirrors it; `satisfies LocaleShape` makes a missing
  or extra key a **typecheck error**.
- `createI18n({ locale?, plugins? })` — framework-free i18next factory
  (ICU loaded, resources bundled). React binding is the caller's plugin
  (apps/web passes `initReactI18next`).
- `checkParity(reference, locales)` — pure parity comparison, unit-tested.

## Parity gate (CI)

```
pnpm --filter @dealpilot/i18n check:parity
```

Exits non-zero listing every `missing` / `extra` / `empty` key against fr-CA —
a key present in one language and not the other must fail the build (Bill 96
equivalence). Wire this into CI's i18n step (currently a no-op notice).

## Adding strings

Add the key to **fr-CA first**, then en-CA (typecheck forces it). Never remove
keys in the same change that adds features — removals are their own commit
(TEAM-WORKFLOW §5 locale-merge rule).
