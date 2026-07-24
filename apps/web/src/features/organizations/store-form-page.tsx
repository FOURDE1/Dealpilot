import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { BackLink } from '../../shared/ui/back-link.js';
import { useTranslation } from 'react-i18next';
import { Button, Input, Label, Select } from '@dealpilot/ui';
import type { Locale } from '@dealpilot/i18n';
import { useCreateStore, useStore, useUpdateStore } from './api.js';
import { formErrorMessage } from './form-error.js';

const PROVINCES = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'] as const;
type Province = (typeof PROVINCES)[number];

/** Create AND edit (with :storeId param) for a store within one organization. */
export function StoreFormPage() {
  const { t } = useTranslation('orgs');
  const navigate = useNavigate();
  const { orgId = '', storeId } = useParams();
  const isEdit = storeId !== undefined;

  const existing = useStore(orgId, storeId ?? '');
  const createStore = useCreateStore(orgId);
  const updateStore = useUpdateStore(orgId, storeId ?? '');

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [province, setProvince] = useState<Province>('QC');
  const [city, setCity] = useState('');
  const [locale, setLocale] = useState<Locale>('fr-CA');
  const [error, setError] = useState<string | null>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);
  // Populate ONCE per store — a background refetch must never clobber edits.
  const initializedFor = useRef<string | null>(null);

  useEffect(() => {
    if (isEdit && existing.data && initializedFor.current !== existing.data.id) {
      initializedFor.current = existing.data.id;
      setName(existing.data.name);
      setCode(existing.data.code);
      setProvince(existing.data.province);
      setCity(existing.data.city ?? '');
      setLocale(existing.data.default_locale);
    }
  }, [isEdit, existing.data]);

  useEffect(() => {
    if (error) alertRef.current?.focus();
  }, [error]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      if (isEdit) {
        if (!existing.data) return; // form is only rendered once loaded
        // PATCH only what changed — never rewrite unrelated fields.
        const changes: Parameters<typeof updateStore.mutateAsync>[0] = {};
        if (name !== existing.data.name) changes.name = name;
        if (code !== existing.data.code) changes.code = code;
        if (province !== existing.data.province) changes.province = province;
        if ((city || null) !== existing.data.city) changes.city = city || null;
        if (locale !== existing.data.default_locale) changes.default_locale = locale;
        if (Object.keys(changes).length > 0) await updateStore.mutateAsync(changes);
      } else {
        // timezone/status mirror the server defaults; dedicated fields come
        // with a later slice (the schema output type requires them).
        await createStore.mutateAsync({
          organization_id: orgId,
          name,
          code,
          province,
          city: city || undefined,
          default_locale: locale,
          timezone: 'America/Montreal',
          status: 'active',
        });
      }
      navigate(`/organizations/${orgId}`, { replace: true });
    } catch (err) {
      setError(formErrorMessage(t, err, 'code'));
    }
  }

  const busy = createStore.isPending || updateStore.isPending;
  if (isEdit && existing.isPending) {
    return (
      <p className="text-sm text-muted-foreground" aria-busy="true">
        {t('loading')}
      </p>
    );
  }
  if (isEdit && existing.isError) {
    return (
      <p role="alert" className="text-sm text-danger-text">
        {t('loadError')}
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <BackLink to={`/organizations/${orgId}`}>{t('back')}</BackLink>
      <h1 className="text-2xl font-semibold">{isEdit ? t('editStore') : t('newStore')}</h1>
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="space-y-4 rounded-lg border border-border bg-card p-6"
        noValidate
      >
        <div className="space-y-1">
          <Label htmlFor="store-name">{t('storeName')}</Label>
          <Input id="store-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="store-code">{t('storeCode')}</Label>
          <Input
            id="store-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-describedby="store-code-hint"
            className="font-mono"
            required
          />
          <p id="store-code-hint" className="text-xs text-muted-foreground">
            {t('storeCodeHint')}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="store-province">{t('province')}</Label>
            <Select
              id="store-province"
              value={province}
              onChange={(e) => setProvince(e.target.value as Province)}
            >
              {PROVINCES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="store-city">{t('city')}</Label>
            <Input id="store-city" value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="store-locale">{t('defaultLocale')}</Label>
          <Select id="store-locale" value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
            <option value="fr-CA">{t('localeFr')}</option>
            <option value="en-CA">{t('localeEn')}</option>
          </Select>
        </div>
        {error ? (
          <p
            ref={alertRef}
            tabIndex={-1}
            role="alert"
            className="rounded-md border border-destructive px-3 py-2 text-sm text-danger-text"
          >
            {error}
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? t('saving') : isEdit ? t('save') : t('createStore')}
        </Button>
      </form>
    </div>
  );
}
