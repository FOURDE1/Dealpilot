import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { BackLink } from '../../shared/ui/back-link.js';
import { useTranslation } from 'react-i18next';
import { Button, Input, Label, Select, buttonVariants } from '@dealpilot/ui';
import type { Locale } from '@dealpilot/i18n';
import { ApiError, useOrganization, useStores, useUpdateOrganization } from './api.js';
import { can, usePermissionsMine } from '../../shared/permissions.js';

export function OrganizationDetailPage() {
  const { t } = useTranslation('orgs');
  const { orgId = '' } = useParams();
  const org = useOrganization(orgId);
  const stores = useStores(orgId);
  const updateOrg = useUpdateOrganization(orgId);
  const mine = usePermissionsMine(orgId);
  // The branding editor is organization:update-gated — only offer it to holders.
  const canBrand = can(mine.data, 'organization:update');

  const [name, setName] = useState('');
  const [locale, setLocale] = useState<Locale>('fr-CA');
  const [feedback, setFeedback] = useState<'saved' | 'error' | null>(null);
  // Populate ONCE per org — a background refetch must never clobber edits.
  const initializedFor = useRef<string | null>(null);

  useEffect(() => {
    if (org.data && initializedFor.current !== org.data.id) {
      initializedFor.current = org.data.id;
      setName(org.data.name);
      setLocale(org.data.default_locale);
    }
  }, [org.data]);

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setFeedback(null);
    try {
      await updateOrg.mutateAsync({ name, default_locale: locale });
      setFeedback('saved');
    } catch (err) {
      setFeedback('error');
      // Non-API failures are bugs (contract drift, coding errors) — surface them.
      if (!(err instanceof ApiError)) throw err;
    }
  }

  if (org.isPending) {
    return (
      <p className="text-sm text-muted-foreground" aria-busy="true">
        {t('loading')}
      </p>
    );
  }
  if (org.isError) {
    return (
      <p role="alert" className="text-sm text-danger-text">
        {t('loadError')}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <BackLink to={"/organizations"}>{t('back')}</BackLink>
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl font-semibold">{org.data.name}</h1>
          <span className="font-mono text-sm text-muted-foreground">{org.data.slug}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canBrand ? (
            <Link to={`/organizations/${orgId}/branding`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              {t('brandingLink')}
            </Link>
          ) : null}
          {/* F-76: « Réglages » is desktop-only in the nav (mobileHidden) — this
              link is how a phone reaches /settings. */}
          <Link to="/settings" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            {t('settingsLink')}
          </Link>
        </div>
      </header>

      <form
        onSubmit={(e) => void handleSave(e)}
        className="max-w-lg space-y-4 rounded-lg border border-border bg-card p-6"
        noValidate
      >
        <div className="space-y-1">
          <Label htmlFor="edit-name">{t('name')}</Label>
          <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="edit-locale">{t('defaultLocale')}</Label>
          <Select id="edit-locale" value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
            <option value="fr-CA">{t('localeFr')}</option>
            <option value="en-CA">{t('localeEn')}</option>
          </Select>
        </div>
        {feedback === 'saved' ? (
          <p role="status" className="text-sm font-medium text-success-text">
            {t('saved')}
          </p>
        ) : null}
        {feedback === 'error' ? (
          <p role="alert" className="text-sm text-danger-text">
            {t('genericError')}
          </p>
        ) : null}
        <Button type="submit" disabled={updateOrg.isPending}>
          {updateOrg.isPending ? t('saving') : t('save')}
        </Button>
      </form>

      <section className="space-y-3">
        <header className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{t('storesTitle')}</h2>
          <Link to={`/organizations/${orgId}/stores/new`} className={buttonVariants({ size: 'sm' })}>
            {t('newStore')}
          </Link>
        </header>
        {stores.isPending ? (
          <p className="text-sm text-muted-foreground" aria-busy="true">
            {t('loading')}
          </p>
        ) : stores.isError ? (
          <p role="alert" className="text-sm text-danger-text">
            {t('loadError')}
          </p>
        ) : stores.data.items.length === 0 ? (
          <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
            {t('storesEmpty')}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 text-start">{t('storeName')}</th>
                  <th className="px-4 py-2.5 text-start">{t('storeCode')}</th>
                  <th className="px-4 py-2.5 text-start">{t('province')}</th>
                  <th className="px-4 py-2.5 text-start">{t('city')}</th>
                </tr>
              </thead>
              <tbody>
                {stores.data.items.map((store) => (
                  <tr key={store.id} className="border-b border-border last:border-b-0 hover:bg-muted">
                    <td className="px-4 py-2.5 font-medium">
                      <Link
                        to={`/organizations/${orgId}/stores/${store.id}`}
                        className="text-primary-text hover:underline"
                      >
                        {store.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[13px]">{store.code}</td>
                    <td className="px-4 py-2.5">{store.province}</td>
                    <td className="px-4 py-2.5">{store.city ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
