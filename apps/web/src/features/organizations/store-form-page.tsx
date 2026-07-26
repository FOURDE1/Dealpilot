import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { BackLink } from '../../shared/ui/back-link.js';
import { useTranslation } from 'react-i18next';
import { Button, Input, Label, Select } from '@dealpilot/ui';
import { BillOfSaleSystem, StoreEsignPlatform } from '@dealpilot/schemas';
import type { Locale } from '@dealpilot/i18n';
import { useCreateStore, useStore, useUpdateStore } from './api.js';
import { formErrorMessage } from './form-error.js';
import { IntakeSources } from './intake-sources.js';
import { ChecklistTemplateSection } from '../checklists/template-section.js';
import { FleetSection } from '../dispatch/fleet-section.js';

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
  // F-13b/F-13c store settings (Ahmad's contract) — configured after opening.
  const [bosSystem, setBosSystem] = useState<'CAMS' | 'Merlin' | 'Other'>('CAMS');
  const [esign, setEsign] = useState<'' | 'onespan' | 'docusign'>('');
  const [conflictWindow, setConflictWindow] = useState('4');
  const [error, setError] = useState<string | null>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);
  // Populate ONCE per store — a background refetch must never clobber edits.
  const initializedFor = useRef<string | null>(null);
  // The values the form OPENED with. The submit diff compares against this, not
  // the live query: refetchOnWindowFocus can replace existing.data with a
  // colleague's concurrent change, and diffing an untouched field against that
  // would PATCH the stale open-time value back over it (silent revert).
  const baseline = useRef<NonNullable<typeof existing.data> | null>(null);

  useEffect(() => {
    if (isEdit && existing.data && initializedFor.current !== existing.data.id) {
      initializedFor.current = existing.data.id;
      baseline.current = existing.data;
      setName(existing.data.name);
      setCode(existing.data.code);
      setProvince(existing.data.province);
      setCity(existing.data.city ?? '');
      setLocale(existing.data.default_locale);
      setBosSystem(existing.data.bill_of_sale_system);
      setEsign(existing.data.esign_platform ?? '');
      setConflictWindow(String(existing.data.dispatch_conflict_window_hours));
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
        const base = baseline.current;
        if (!base) return; // form is only rendered once loaded
        // PATCH only what the USER changed (diff vs the open-time baseline) —
        // never rewrite unrelated fields, and never revert a concurrent edit.
        const changes: Parameters<typeof updateStore.mutateAsync>[0] = {};
        if (name !== base.name) changes.name = name;
        if (code !== base.code) changes.code = code;
        if (province !== base.province) changes.province = province;
        if ((city || null) !== base.city) changes.city = city || null;
        if (locale !== base.default_locale) changes.default_locale = locale;
        if (bosSystem !== base.bill_of_sale_system) changes.bill_of_sale_system = bosSystem;
        if ((esign || null) !== base.esign_platform) changes.esign_platform = esign || null;
        const window = Number(conflictWindow);
        if (
          conflictWindow.trim() !== '' &&
          Number.isInteger(window) &&
          window !== base.dispatch_conflict_window_hours
        ) {
          changes.dispatch_conflict_window_hours = window;
        }
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

  const windowNum = Number(conflictWindow);
  const windowInvalid =
    conflictWindow.trim() !== '' &&
    (!/^\d+$/.test(conflictWindow.trim()) || windowNum < 1 || windowNum > 24);
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
    <div className={isEdit ? "mx-auto max-w-2xl space-y-6" : "mx-auto max-w-lg space-y-4"}>
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
        {isEdit ? (
          <fieldset className="space-y-4 rounded-md border border-border p-4">
            <legend className="px-1 text-sm font-semibold">{t('storeSettings')}</legend>
            <div className="space-y-1">
              <Label htmlFor="store-bos">{t('billOfSaleSystem')}</Label>
              <Select
                id="store-bos"
                value={bosSystem}
                aria-describedby="store-bos-hint"
                onChange={(e) => setBosSystem(e.target.value as typeof bosSystem)}
              >
                {BillOfSaleSystem.options.map((s) => (
                  <option key={s} value={s}>
                    {t(`bos_${s}`)}
                  </option>
                ))}
              </Select>
              <p id="store-bos-hint" className="text-xs text-muted-foreground">
                {t('billOfSaleSystemHint')}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="store-esign">{t('esignPlatform')}</Label>
                <Select
                  id="store-esign"
                  value={esign}
                  onChange={(e) => setEsign(e.target.value as typeof esign)}
                >
                  <option value="">{t('esignNone')}</option>
                  {StoreEsignPlatform.options.map((p) => (
                    <option key={p} value={p}>
                      {t(`esign_${p}`)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="store-window">{t('conflictWindow')}</Label>
                <Input
                  id="store-window"
                  inputMode="numeric"
                  value={conflictWindow}
                  aria-invalid={windowInvalid || undefined}
                  aria-describedby={windowInvalid ? 'store-window-error' : 'store-window-hint'}
                  className={windowInvalid ? 'border-danger-border' : undefined}
                  onChange={(e) => setConflictWindow(e.target.value)}
                />
                {windowInvalid ? (
                  <p id="store-window-error" role="alert" className="text-xs text-danger-text">
                    {t('conflictWindowError')}
                  </p>
                ) : (
                  <p id="store-window-hint" className="text-xs text-muted-foreground">
                    {t('conflictWindowHint')}
                  </p>
                )}
              </div>
            </div>
          </fieldset>
        ) : null}
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
        <Button type="submit" className="w-full" disabled={busy || windowInvalid}>
          {busy ? t('saving') : isEdit ? t('save') : t('createStore')}
        </Button>
      </form>

      {isEdit && storeId ? <IntakeSources key={storeId} orgId={orgId} storeId={storeId} /> : null}
      {isEdit && storeId ? <ChecklistTemplateSection key={`chk-${storeId}`} storeId={storeId} /> : null}
      {isEdit && storeId ? <FleetSection key={`fleet-${storeId}`} orgId={orgId} storeId={storeId} /> : null}
    </div>
  );
}
