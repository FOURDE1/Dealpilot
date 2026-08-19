import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../../shared/use-page-title.js';
import { Button, Input, Label, Select } from '@dealpilot/ui';
import { ApiError } from '../../shared/api/client.js';
import { useOrganizations, useStores } from '../organizations/api.js';
import { useDistribution, useDistributionHistory, usePutDistributionConfig } from './api.js';

/**
 * F-45 — the distribution dashboard (FR-LEAD-008, leads.md §3).
 *
 * An owner's money screen: each store's ad-spend share (the TARGET), its
 * share of the month's leads (the ACTUAL), and the deviation between them —
 * per platform, because Google and Meta never share a tally. The API refuses
 * anyone without organization:update; this screen shows the server's refusal
 * rather than hiding behind a disabled button.
 *
 * Spend is typed in DOLLARS and stored in cents (ADR-009) — the conversion
 * happens exactly once, at the edge, here.
 */

const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

const monthLabel = (iso: string, locale: string) =>
  new Date(`${iso.slice(0, 7)}-02T00:00:00`).toLocaleDateString(locale, { year: 'numeric', month: 'long' });

export function DistributionPage() {
  const { t } = useTranslation('distribution');
  const { i18n } = useTranslation();
  usePageTitle(t('title'));
  const orgs = useOrganizations();
  const multiOrg = (orgs.data?.items.length ?? 0) > 1;
  const [orgFilter, setOrgFilter] = useState('');
  const orgId = multiOrg ? orgFilter || orgs.data?.items[0]?.id : orgs.data?.items[0]?.id;
  const stores = useStores(orgId ?? '');

  const [platform, setPlatform] = useState<'google' | 'meta'>('meta');
  const current = useDistribution(orgId, platform);
  const history = useDistributionHistory(orgId, platform);
  const putConfig = usePutDistributionConfig();

  // Spend drafts in DOLLARS, keyed by store — seeded from the ledger when it
  // loads, editable before one Save writes the whole platform-month.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const storeName = (id: string) => stores.data?.items.find((s) => s.id === id)?.name ?? '…';

  const seeded = useMemo(() => {
    const out: Record<string, string> = {};
    for (const s of stores.data?.items ?? []) {
      const row = current.data?.items.find((r) => r.store_id === s.id);
      out[s.id] = row ? String(row.contribution_amount_cents / 100) : '';
    }
    return out;
  }, [stores.data, current.data]);

  const value = (storeId: string) => drafts[storeId] ?? seeded[storeId] ?? '';

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!orgId) return;
    setFormError(null);
    setSaved(false);
    const entries: Array<{ store_id: string; contribution_amount_cents: number }> = [];
    for (const s of stores.data?.items ?? []) {
      const raw = value(s.id).trim();
      if (raw === '') continue;
      const dollars = Number(raw.replace(',', '.'));
      if (!Number.isFinite(dollars) || dollars < 0) {
        setFormError(t('spendInvalid', { store: s.name }));
        return;
      }
      entries.push({ store_id: s.id, contribution_amount_cents: Math.round(dollars * 100) });
    }
    if (entries.length === 0) {
      setFormError(t('spendEmpty'));
      return;
    }
    try {
      await putConfig.mutateAsync({ organization_id: orgId, platform, month: currentMonth(), entries });
      setDrafts({});
      setSaved(true);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t('genericError'));
    }
  }

  const deviationClass = (d: string) => {
    const n = Number(d);
    if (Math.abs(n) < 5) return 'text-success-text';
    return n < 0 ? 'text-warning-text' : 'text-danger-text';
  };

  const historyMonths = useMemo(() => {
    const byMonth = new Map<string, typeof history.data extends undefined ? never[] : NonNullable<typeof history.data>['items']>();
    for (const row of history.data?.items ?? []) {
      const key = row.month.slice(0, 10);
      const list = byMonth.get(key) ?? [];
      list.push(row);
      byMonth.set(key, list);
    }
    return [...byMonth.entries()];
  }, [history.data]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        <p className="mt-1 text-sm">
          <Link to="/leads" className="font-medium text-primary underline-offset-4 hover:underline">
            {t('backToLeads')}
          </Link>
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          {multiOrg ? (
            <div className="max-w-xs space-y-1">
              <Label htmlFor="di-org">{t('orgScope')}</Label>
              <Select id="di-org" value={orgId ?? ''} onChange={(e) => setOrgFilter(e.target.value)}>
                {orgs.data?.items.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </Select>
            </div>
          ) : null}
          <div className="max-w-xs space-y-1">
            <Label htmlFor="di-platform">{t('platform')}</Label>
            <Select id="di-platform" value={platform} onChange={(e) => setPlatform(e.target.value as 'google' | 'meta')}>
              <option value="meta">{t('platform_meta')}</option>
              <option value="google">{t('platform_google')}</option>
            </Select>
          </div>
        </div>
      </header>

      {current.isError ? (
        <p role="alert" className="text-sm text-danger-text">
          {current.error instanceof ApiError && current.error.status === 403 ? t('forbidden') : t('genericError')}
        </p>
      ) : (
        <>
          <section aria-label={t('monthTitle')} className="max-w-4xl space-y-2">
            <h2 className="text-lg font-medium">
              {t('monthTitle')} — {monthLabel(currentMonth(), i18n.language)}
            </h2>
            {(current.data?.items.length ?? 0) === 0 ? (
              <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">{t('empty')}</div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50 text-start">
                      <th scope="col" className="p-2 text-start">{t('colStore')}</th>
                      <th scope="col" className="p-2 text-end">{t('colSpend')}</th>
                      <th scope="col" className="p-2 text-end">{t('colTarget')}</th>
                      <th scope="col" className="p-2 text-end">{t('colLeads')}</th>
                      <th scope="col" className="p-2 text-end">{t('colActual')}</th>
                      <th scope="col" className="p-2 text-end">{t('colDeviation')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {current.data?.items.map((row) => (
                      <tr key={row.id} className="border-b border-border last:border-0">
                        <td className="p-2">{storeName(row.store_id)}</td>
                        <td className="p-2 text-end font-mono tabular-nums">
                          {(row.contribution_amount_cents / 100).toLocaleString(i18n.language, { style: 'currency', currency: 'CAD' })}
                        </td>
                        <td className="p-2 text-end font-mono tabular-nums">{row.contribution_percentage} %</td>
                        <td className="p-2 text-end font-mono tabular-nums">{row.leads_received}</td>
                        <td className="p-2 text-end font-mono tabular-nums">{row.actual_percentage} %</td>
                        <td className={`p-2 text-end font-mono tabular-nums ${deviationClass(row.deviation)}`}>
                          {Number(row.deviation) > 0 ? '+' : ''}{row.deviation} {t('pts')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <form onSubmit={(e) => void onSave(e)} className="max-w-4xl space-y-3 rounded-lg border border-border p-4" aria-label={t('spendTitle')}>
            <h2 className="text-lg font-medium">{t('spendTitle')}</h2>
            <p className="text-sm text-muted-foreground">{t('spendHint')}</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {stores.data?.items.map((s) => (
                <div key={s.id} className="space-y-1">
                  <Label htmlFor={`di-spend-${s.id}`}>{s.name}</Label>
                  <Input
                    id={`di-spend-${s.id}`}
                    inputMode="decimal"
                    value={value(s.id)}
                    onChange={(e) => {
                      setDrafts((d) => ({ ...d, [s.id]: e.target.value }));
                      setFormError(null);
                      setSaved(false);
                    }}
                    placeholder={t('spendPlaceholder')}
                  />
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={putConfig.isPending || orgId === undefined}>
                {t('saveButton')}
              </Button>
              {saved ? <p role="status" className="text-sm text-success-text">{t('savedNote')}</p> : null}
            </div>
            {formError ? <p role="alert" className="text-sm text-danger-text">{formError}</p> : null}
          </form>

          <section aria-label={t('historyTitle')} className="max-w-4xl space-y-2">
            <h2 className="text-lg font-medium">{t('historyTitle')}</h2>
            {historyMonths.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('historyEmpty')}</p>
            ) : (
              historyMonths.map(([month, rows]) => (
                <div key={month} className="rounded-lg border border-border p-3 text-sm">
                  <h3 className="mb-1 font-medium">{monthLabel(month, i18n.language)}</h3>
                  <ul className="space-y-1">
                    {rows.map((row) => (
                      <li key={row.id} className="flex flex-wrap justify-between gap-2">
                        <span>{storeName(row.store_id)}</span>
                        <span className="font-mono tabular-nums text-muted-foreground">
                          {row.contribution_percentage} % → {row.actual_percentage} %
                          <span className={`ms-2 ${deviationClass(row.deviation)}`}>
                            {Number(row.deviation) > 0 ? '+' : ''}{row.deviation}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </section>
        </>
      )}
    </div>
  );
}
