/**
 * Token demo generator (H-02 DoD: a themed page proving the locked tokens
 * drive the components in BOTH themes). Static markup only — run via
 * `pnpm --filter @dealpilot/ui demo`, which writes dist/demo/index.html and
 * compiles dist/demo/demo.css with Tailwind.
 *
 * Both themes render side by side by scoping `data-theme` to each panel —
 * the same attribute the app toggles on <html> (white-labeling §4).
 */
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button } from '../components/button.js';

function Chip({ tone, children }: { tone: 'success' | 'warning' | 'destructive' | 'info'; children: ReactNode }) {
  const tones = {
    success: 'bg-success text-success-foreground',
    warning: 'bg-warning text-warning-foreground',
    destructive: 'bg-destructive text-destructive-foreground',
    info: 'bg-info text-info-foreground',
  } as const;
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${tones[tone]}`}>
      {children}
    </span>
  );
}

function ThemePanel({ theme, label }: { theme: 'light' | 'dark'; label: string }) {
  return (
    <section data-theme={theme} className="min-w-0 flex-1 basis-80">
      <div className="flex min-h-full overflow-hidden rounded-lg border border-border bg-background text-foreground">
        <aside className="hidden w-40 shrink-0 flex-col gap-1 border-e border-border bg-sidebar p-3 text-sidebar-foreground sm:flex">
          <p className="px-2 pb-2 text-sm font-bold">1Dealer</p>
          <span className="rounded-md bg-sidebar-accent px-2 py-1.5 text-[13px] font-medium text-sidebar-accent-foreground">
            Tableau de bord
          </span>
          <span className="px-2 py-1.5 text-[13px] text-muted-foreground">Prospects</span>
          <span className="px-2 py-1.5 text-[13px] text-muted-foreground">Pipeline</span>
        </aside>
        <div className="min-w-0 flex-1 space-y-4 p-4">
          <header className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold">{label}</h2>
            <a href="#demo" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
              Voir tout
            </a>
          </header>

          <div className="rounded-lg border border-border bg-card p-4 text-card-foreground">
            <h3 className="text-[15px] font-semibold">Ventes du mois</h3>
            <p className="text-5xl font-bold tabular-nums">
              4 250 <span className="text-lg font-medium text-muted-foreground">$</span>
            </p>
            <p className="text-sm text-muted-foreground">42 livraisons — objectif atteint à 86 %</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button>Enregistrer</Button>
            <Button variant="secondary">Annuler</Button>
            <Button variant="outline">Filtrer</Button>
            <Button variant="ghost">Détails</Button>
            <Button variant="destructive">Supprimer</Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Chip tone="success">Financé</Chip>
            <Chip tone="warning">En attente</Chip>
            <Chip tone="destructive">Perdu</Chip>
            <Chip tone="info">Nouveau</Chip>
          </div>

          <p className="text-sm">
            <span className="font-medium text-success-text">+12 % vs juin</span>{' '}
            <span className="text-warning-text">3 dossiers en retard</span>{' '}
            <span className="text-danger-text">1 vente perdue</span>
          </p>

          <label className="block space-y-1">
            <span className="text-[13px] font-medium">Nom du client</span>
            <input
              className="h-10 w-full rounded-md border border-input bg-input-bg px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring max-lg:min-h-11"
              placeholder="Tremblay, Marie"
            />
          </label>
        </div>
      </div>
    </section>
  );
}

const page = (
  <html lang="fr-CA">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>1Dealer — Jetons Nordique (D-024)</title>
      <link rel="stylesheet" href="./demo.css" />
    </head>
    <body className="bg-background p-6 font-sans text-foreground" data-theme="light">
      <main id="demo" className="mx-auto max-w-5xl space-y-4">
        <h1 className="text-2xl font-semibold">Démo des jetons — direction «&nbsp;Nordique&nbsp;»</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Les deux thèmes rendus côte à côte depuis les mêmes composants — seule la valeur de
          <code className="font-mono"> data-theme </code> change (D-024).
        </p>
        <div className="flex flex-wrap gap-4">
          <ThemePanel theme="light" label="Thème clair" />
          <ThemePanel theme="dark" label="Thème sombre" />
        </div>
      </main>
    </body>
  </html>
);

// Build script writing its artifact to stdout (redirected to index.html) —
// not application logging, which stays pino-only.
console.log('<!doctype html>' + renderToStaticMarkup(page));
