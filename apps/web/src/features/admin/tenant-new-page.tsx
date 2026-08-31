import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Input, Label, Select } from '@dealpilot/ui';
import { ProvinceCA, type AdminTenantProvisionedT } from '@dealpilot/schemas';
import { TRIAL_DAYS } from '@dealpilot/core';
import { BackLink } from '../../shared/ui/back-link.js';
import { usePageTitle } from '../../shared/use-page-title.js';
import { ApiError } from '../../shared/api/client.js';
import { useAdminPlans, useProvisionTenant } from './api.js';
import { TIER_KEYS } from './labels.js';
import {
  CANADA_TIMEZONES,
  codeOf,
  draftToBody,
  emptyDraft,
  emptyStore,
  localeFor,
  slugify,
  storeCodesUnique,
  timezoneFor,
  type ProvinceCAT,
  type TenantDraft,
} from './provisioning-defaults.js';

/**
 * F-70 — provision a tenant (admin-console.md §4.3). One form, three
 * sections: the organization, its founding owner, its stores. Client-side
 * checks cover only the obvious (required, a code used twice); the server is
 * the validation layer, and every refusal it sends comes back tied to its
 * field (`stores.1.code`, `slug`, `plan_id`) plus a focused summary that
 * links to each offending input (WCAG 3.3.1/3.3.3, 2.4.3).
 *
 * The result renders in place: the accept link exists ONLY in the 201 when
 * the mailer cannot reach the owner, so the page that made the tenant is
 * the page that has to show it.
 */

const OTHER_TZ = '__other__';
const MAX_STORES = 20;

/** `stores.1.code` → `tn-stores-1-code` — one rule for ids, error links and focus. */
const fieldId = (path: string) => `tn-${path.replace(/[._]/g, '-')}`;

/** Labels, never raw wire paths (H-04): what a refusal calls the field. */
const FIELD_LABEL = {
  display_name: 'displayName',
  legal_name: 'legalNameRequired',
  slug: 'slug',
  province: 'provinceLabel',
  default_locale: 'localeLabel',
  plan_id: 'planLabel',
  owner_name: 'ownerName',
  owner_email: 'ownerEmail',
} as const;
const STORE_FIELD_LABEL = {
  name: 'storeName',
  code: 'storeCode',
  province: 'storeProvince',
  city: 'storeCity',
  timezone: 'storeTimezone',
} as const;
const labelKey = <M extends Record<string, string>>(map: M, key: string): M[keyof M] | undefined =>
  Object.prototype.hasOwnProperty.call(map, key) ? map[key as keyof M] : undefined;
const REQUIRED_TOP = ['display_name', 'legal_name', 'slug', 'plan_id', 'owner_name', 'owner_email'] as const;
const REQUIRED_STORE = ['name', 'code', 'timezone'] as const;

function isKnownTimezone(tz: string): boolean {
  return (CANADA_TIMEZONES as readonly string[]).includes(tz);
}

export function TenantNewPage() {
  const { t, i18n } = useTranslation('admin');
  const { t: tOrgs } = useTranslation('orgs');
  // Province names live with the deal paperwork vocabulary (one list, F-13).
  const { t: tDeals } = useTranslation('deals');
  usePageTitle(t('newTenantTitle'));
  const plans = useAdminPlans();
  const provision = useProvisionTenant();

  const [draft, setDraft] = useState<TenantDraft>(emptyDraft);
  const [slugTouched, setSlugTouched] = useState(false);
  const [localeTouched, setLocaleTouched] = useState(false);
  const [codeTouched, setCodeTouched] = useState<boolean[]>([false]);
  const [customTz, setCustomTz] = useState<boolean[]>([false]);
  // A zone the staffer picked (from the list or typed) survives a province change.
  const [tzTouched, setTzTouched] = useState<boolean[]>([false]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [result, setResult] = useState<AdminTenantProvisionedT | null>(null);
  const [copied, setCopied] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const legendRefs = useRef<(HTMLLegendElement | null)[]>([]);

  const fmtDate = (iso: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long' }).format(new Date(iso));

  const patch = (p: Partial<TenantDraft>) => setDraft((d) => ({ ...d, ...p }));
  const patchStore = (i: number, p: Partial<TenantDraft['stores'][number]>) =>
    setDraft((d) => ({ ...d, stores: d.stores.map((s, j) => (j === i ? { ...s, ...p } : s)) }));

  const addStore = () => {
    if (draft.stores.length >= MAX_STORES) return;
    setDraft((d) => ({ ...d, stores: [...d.stores, emptyStore(d.province)] }));
    setCodeTouched((c) => [...c, false]);
    setCustomTz((c) => [...c, false]);
    setTzTouched((c) => [...c, false]);
  };

  const removeStore = (i: number) => {
    if (draft.stores.length <= 1) return;
    setDraft((d) => ({ ...d, stores: d.stores.filter((_, j) => j !== i) }));
    setCodeTouched((c) => c.filter((_, j) => j !== i));
    setCustomTz((c) => c.filter((_, j) => j !== i));
    setTzTouched((c) => c.filter((_, j) => j !== i));
    // Errors follow their rows: the removed row's go, later rows shift up.
    setFieldErrors((errors) => {
      const next: Record<string, string> = {};
      for (const [path, message] of Object.entries(errors)) {
        const m = /^stores\.(\d+)\.(.+)$/.exec(path);
        if (!m) { next[path] = message; continue; }
        const j = Number(m[1]);
        if (j === i) continue;
        next[j > i ? `stores.${j - 1}.${m[2]}` : path] = message;
      }
      return next;
    });
    // The removed row's button is gone: park focus on the previous store's
    // legend (or the add button when the first row went).
    requestAnimationFrame(() => (legendRefs.current[Math.max(0, i - 1)] ?? document.getElementById('tn-add-store'))?.focus());
  };

  /** The field's visible label for a path like `slug` or `stores.1.code`. */
  const labelFor = (path: string): string => {
    const m = /^stores\.(\d+)\.(.+)$/.exec(path);
    if (m) {
      const key = labelKey(STORE_FIELD_LABEL, m[2]!);
      return t('storeField', { n: Number(m[1]) + 1, field: key ? t(key) : m[2] });
    }
    const key = labelKey(FIELD_LABEL, path);
    return key ? t(key) : path;
  };

  /** A server refusal in the reader's words, keyed by the detail code first. */
  const messageFor = (code: string | undefined, path: string): string => {
    switch (code) {
      case 'unknown_timezone': return t('unknownTimezone');
      case 'unknown_plan': return t('unknownPlan');
      case 'duplicate_store_code': return t('duplicateStoreCode');
      case 'org_slug_reserved':
      case 'org_slug_format': return tOrgs('slugInvalid');
      case 'store_code_format': return tOrgs('codeInvalid');
      case 'slug_taken': return t('slugTaken');
      default: return t('invalidField', { field: labelFor(path) });
    }
  };

  const refuse = (errors: Record<string, string>) => {
    setFieldErrors(errors);
    setAlert(t('fixErrors'));
    requestAnimationFrame(() => summaryRef.current?.focus());
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setAlert(null);
    setExistingId(null);
    setFieldErrors({});
    const body = draftToBody(draft);
    // The client-side rules worth having — the obvious ones the server would
    // also refuse, while the person is still looking at the row: a blank
    // required field, a code used twice. Everything else is the server's.
    const errors: Record<string, string> = {};
    for (const key of REQUIRED_TOP) if (!body[key]) errors[key] = t('required', { field: labelFor(key) });
    body.stores.forEach((s, i) => {
      for (const key of REQUIRED_STORE) if (!s[key]) errors[`stores.${i}.${key}`] = t('required', { field: labelFor(`stores.${i}.${key}`) });
    });
    if (!storeCodesUnique(body.stores.map((s) => s.code))) {
      const seen = new Set<string>();
      body.stores.forEach((s, i) => {
        if (s.code && seen.has(s.code)) errors[`stores.${i}.code`] = t('duplicateStoreCode');
        seen.add(s.code);
      });
    }
    if (Object.keys(errors).length > 0) {
      refuse(errors);
      return;
    }
    try {
      const created = await provision.mutateAsync(body);
      setResult(created);
      setCopied(false);
      requestAnimationFrame(() => resultRef.current?.focus());
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.errorCode === 'slug_taken') {
        setFieldErrors({ slug: t('slugTaken') });
        setExistingId(err.detailMessages?.[0] ?? null);
        setAlert(t('slugTaken'));
      } else if (err instanceof ApiError && err.status === 422 && err.fieldPath) {
        // Every refused field at once (WCAG 3.3.1), not one per round-trip.
        const paths = err.detailPaths?.length ? err.detailPaths : [err.fieldPath];
        const fromServer: Record<string, string> = {};
        paths.forEach((path, i) => {
          if (path && !fromServer[path]) fromServer[path] = messageFor(err.detailCodes?.[i] ?? err.code, path);
        });
        setFieldErrors(fromServer);
        setAlert(t('fixErrors'));
      } else {
        setAlert(t('saveError'));
      }
      requestAnimationFrame(() => summaryRef.current?.focus());
    }
  };

  const errorProps = (path: string) => {
    const message = fieldErrors[path];
    return message ? { 'aria-invalid': true as const, 'aria-describedby': `${fieldId(path)}-error` } : {};
  };
  const errorText = (path: string) => {
    const message = fieldErrors[path];
    return message ? <p id={`${fieldId(path)}-error`} role="alert" className="text-xs text-danger-text">{message}</p> : null;
  };
  const errorPaths = Object.keys(fieldErrors);

  if (result) {
    const { tenant, invitation } = result;
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <BackLink to="/admin/tenants">{t('back')}</BackLink>
        <h1 className="text-2xl font-semibold">{t('newTenantTitle')}</h1>
        <div ref={resultRef} tabIndex={-1} role="status" className="space-y-3 rounded-lg border border-border bg-card p-6 outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <p className="text-sm font-medium text-success-text">{t('provisioned', { name: tenant.name })}</p>
          <p className="text-sm text-muted-foreground">{t('trialEndsAtValue', { date: tenant.trial_ends_at ? fmtDate(tenant.trial_ends_at) : '—' })}</p>
          {invitation.accept_url ? (
            <div className="space-y-2">
              <p className="text-sm text-warning-text">{t('acceptUrlHint')}</p>
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-64 flex-1 space-y-1">
                  <Label htmlFor="tn-accept-url">{t('acceptUrlLabel')}</Label>
                  <Input id="tn-accept-url" readOnly value={invitation.accept_url} className="font-mono text-[12px]" onFocus={(e) => e.target.select()} />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(invitation.accept_url ?? '').then(() => setCopied(true));
                  }}
                >
                  {t('copyLink')}
                </Button>
              </div>
              <p aria-live="polite" className={`text-xs text-success-text ${copied ? '' : 'sr-only'}`}>{copied ? t('copied') : ''}</p>
            </div>
          ) : (
            <p className="text-sm">{t('inviteSent', { email: invitation.email })}</p>
          )}
          <p className="text-xs text-muted-foreground">{t('invitationExpires', { date: fmtDate(invitation.expires_at) })}</p>
          <Link to={`/admin/tenants/${tenant.id}`} className="inline-flex min-h-11 items-center underline underline-offset-4">{t('openTenant')}</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <BackLink to="/admin/tenants">{t('back')}</BackLink>
      <h1 className="text-2xl font-semibold">{t('newTenantTitle')}</h1>

      {alert ? (
        <div ref={summaryRef} tabIndex={-1} role="alert" className="space-y-1 rounded-md border border-danger-border px-3 py-2 text-sm text-danger-text outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <p>{alert}</p>
          {existingId ? (
            <Link to={`/admin/tenants/${existingId}`} className="inline-flex min-h-11 items-center underline underline-offset-4">{t('openExisting')}</Link>
          ) : null}
          {errorPaths.length > 0 && !existingId ? (
            <ul className="list-disc ps-5">
              {errorPaths.map((path) => (
                <li key={path}>
                  <a href={`#${fieldId(path)}`} className="underline underline-offset-4">{fieldErrors[path]}</a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <form onSubmit={(e) => void submit(e)} noValidate className="space-y-6">
        <fieldset className="space-y-3 rounded-lg border border-border bg-card p-4">
          <legend className="px-1 text-[15px] font-semibold">{t('orgSection')}</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={fieldId('display_name')}>{t('displayName')}</Label>
              <Input
                id={fieldId('display_name')}
                required
                maxLength={200}
                autoComplete="organization"
                value={draft.display_name}
                onChange={(e) => {
                  patch({ display_name: e.target.value, ...(slugTouched ? {} : { slug: slugify(e.target.value) }) });
                }}
                {...errorProps('display_name')}
              />
              {errorText('display_name')}
            </div>
            <div className="space-y-1">
              <Label htmlFor={fieldId('legal_name')}>{t('legalNameRequired')}</Label>
              <Input id={fieldId('legal_name')} required maxLength={200} value={draft.legal_name} onChange={(e) => patch({ legal_name: e.target.value })} {...errorProps('legal_name')} />
              {errorText('legal_name')}
            </div>
            <div className="space-y-1">
              <Label htmlFor={fieldId('slug')}>{t('slug')}</Label>
              <Input
                id={fieldId('slug')}
                required
                maxLength={40}
                className="font-mono"
                autoComplete="off"
                value={draft.slug}
                onChange={(e) => { setSlugTouched(true); patch({ slug: e.target.value }); }}
                aria-describedby={`tn-slug-hint${fieldErrors['slug'] ? ' tn-slug-error' : ''}`}
                aria-invalid={fieldErrors['slug'] ? true : undefined}
              />
              <p id="tn-slug-hint" className="text-xs text-muted-foreground">{tOrgs('slugHint')}</p>
              {errorText('slug')}
            </div>
            <div className="space-y-1">
              <Label htmlFor={fieldId('province')}>{t('provinceLabel')}</Label>
              <Select
                id={fieldId('province')}
                value={draft.province}
                onChange={(e) => {
                  // The options ARE ProvinceCA.options; the cast names that.
                  const province = e.target.value as ProvinceCAT;
                  patch({ province, ...(localeTouched ? {} : { default_locale: localeFor(province) }) });
                }}
                {...errorProps('province')}
              >
                {ProvinceCA.options.map((p) => (
                  <option key={p} value={p}>{p} — {tDeals(`province_${p}`)}</option>
                ))}
              </Select>
              {errorText('province')}
            </div>
            <div className="space-y-1">
              <Label htmlFor={fieldId('default_locale')}>{t('localeLabel')}</Label>
              <Select id={fieldId('default_locale')} value={draft.default_locale} onChange={(e) => { setLocaleTouched(true); patch({ default_locale: e.target.value as TenantDraft['default_locale'] }); }}>
                <option value="fr-CA">{tOrgs('localeFr')}</option>
                <option value="en-CA">{tOrgs('localeEn')}</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={fieldId('plan_id')}>{t('planLabel')}</Label>
              <Select id={fieldId('plan_id')} required value={draft.plan_id} onChange={(e) => patch({ plan_id: e.target.value })} {...errorProps('plan_id')}>
                <option value="">{plans.isPending ? t('loading') : '—'}</option>
                {(plans.data?.items ?? []).filter((p) => p.active).map((p) => (
                  <option key={p.id} value={p.id}>{p.name} — {tOrgs(TIER_KEYS[p.code])}</option>
                ))}
              </Select>
              {errorText('plan_id')}
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-3 rounded-lg border border-border bg-card p-4">
          <legend className="px-1 text-[15px] font-semibold">{t('ownerSection')}</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={fieldId('owner_name')}>{t('ownerName')}</Label>
              <Input id={fieldId('owner_name')} required maxLength={120} autoComplete="off" value={draft.owner_name} onChange={(e) => patch({ owner_name: e.target.value })} {...errorProps('owner_name')} />
              {errorText('owner_name')}
            </div>
            <div className="space-y-1">
              <Label htmlFor={fieldId('owner_email')}>{t('ownerEmail')}</Label>
              <Input
                id={fieldId('owner_email')}
                type="email"
                required
                maxLength={254}
                autoComplete="off"
                inputMode="email"
                value={draft.owner_email}
                onChange={(e) => patch({ owner_email: e.target.value })}
                aria-describedby={`tn-owner-hint${fieldErrors['owner_email'] ? ' tn-owner-email-error' : ''}`}
                aria-invalid={fieldErrors['owner_email'] ? true : undefined}
              />
              <p id="tn-owner-hint" className="text-xs text-muted-foreground">{t('ownerHint')}</p>
              {errorText('owner_email')}
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-3 rounded-lg border border-border bg-card p-4">
          <legend className="px-1 text-[15px] font-semibold">{t('storesSection')}</legend>
          <p aria-live="polite" className="text-xs text-muted-foreground">{t('storeCount', { count: draft.stores.length })}</p>
          {draft.stores.map((s, i) => {
            // A zone outside the list is typed; the visible control then owns
            // the field's id (and its error), so a summary link lands on it.
            const custom = customTz[i] || !isKnownTimezone(s.timezone);
            const tzPath = `stores.${i}.timezone`;
            const pickId = custom ? `tn-stores-${i}-timezone-pick` : fieldId(tzPath);
            return (
            <fieldset key={i} className="space-y-3 rounded-md border border-border p-3">
              <legend
                ref={(el) => { legendRefs.current[i] = el; }}
                tabIndex={-1}
                className="px-1 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t('storeLegend', { n: i + 1 })}
              </legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor={fieldId(`stores.${i}.name`)}>{t('storeName')}</Label>
                  <Input
                    id={fieldId(`stores.${i}.name`)}
                    required
                    maxLength={200}
                    value={s.name}
                    onChange={(e) => patchStore(i, { name: e.target.value, ...(codeTouched[i] ? {} : { code: codeOf(e.target.value) }) })}
                    {...errorProps(`stores.${i}.name`)}
                  />
                  {errorText(`stores.${i}.name`)}
                </div>
                <div className="space-y-1">
                  <Label htmlFor={fieldId(`stores.${i}.code`)}>{t('storeCode')}</Label>
                  <Input
                    id={fieldId(`stores.${i}.code`)}
                    required
                    maxLength={20}
                    className="font-mono"
                    autoComplete="off"
                    value={s.code}
                    onChange={(e) => { setCodeTouched((c) => c.map((v, j) => (j === i ? true : v))); patchStore(i, { code: e.target.value }); }}
                    onBlur={(e) => patchStore(i, { code: e.target.value.toUpperCase() })}
                    aria-describedby={`tn-stores-${i}-code-hint${fieldErrors[`stores.${i}.code`] ? ` tn-stores-${i}-code-error` : ''}`}
                    aria-invalid={fieldErrors[`stores.${i}.code`] ? true : undefined}
                  />
                  <p id={`tn-stores-${i}-code-hint`} className="text-xs text-muted-foreground">{t('storeCodeHint')}</p>
                  {errorText(`stores.${i}.code`)}
                </div>
                <div className="space-y-1">
                  <Label htmlFor={fieldId(`stores.${i}.province`)}>{t('storeProvince')}</Label>
                  <Select
                    id={fieldId(`stores.${i}.province`)}
                    value={s.province}
                    onChange={(e) => {
                      const province = e.target.value as ProvinceCAT;
                      patchStore(i, { province, ...(tzTouched[i] ? {} : { timezone: timezoneFor(province) }) });
                    }}
                    {...errorProps(`stores.${i}.province`)}
                  >
                    {ProvinceCA.options.map((p) => (
                      <option key={p} value={p}>{p} — {tDeals(`province_${p}`)}</option>
                    ))}
                  </Select>
                  {errorText(`stores.${i}.province`)}
                </div>
                <div className="space-y-1">
                  <Label htmlFor={fieldId(`stores.${i}.city`)} optionalText={t('optional')}>{t('storeCity')}</Label>
                  <Input id={fieldId(`stores.${i}.city`)} maxLength={100} autoComplete="off" value={s.city} onChange={(e) => patchStore(i, { city: e.target.value })} {...errorProps(`stores.${i}.city`)} />
                  {errorText(`stores.${i}.city`)}
                </div>
                <div className="space-y-1">
                  <Label htmlFor={pickId}>{t('storeTimezone')}</Label>
                  <Select
                    id={pickId}
                    value={custom ? OTHER_TZ : s.timezone}
                    onChange={(e) => {
                      const other = e.target.value === OTHER_TZ;
                      setTzTouched((c) => c.map((v, j) => (j === i ? true : v)));
                      setCustomTz((c) => c.map((v, j) => (j === i ? other : v)));
                      if (!other) patchStore(i, { timezone: e.target.value });
                    }}
                    {...(custom ? {} : errorProps(tzPath))}
                  >
                    {CANADA_TIMEZONES.map((tz) => (
                      <option key={tz} value={tz}>{tz}</option>
                    ))}
                    <option value={OTHER_TZ}>{t('timezoneOther')}</option>
                  </Select>
                  {custom ? null : errorText(tzPath)}
                </div>
                {custom ? (
                  <div className="space-y-1">
                    <Label htmlFor={fieldId(tzPath)}>{t('timezoneOther')}</Label>
                    <Input
                      id={fieldId(tzPath)}
                      required
                      className="font-mono"
                      autoComplete="off"
                      placeholder="America/Montreal"
                      value={s.timezone}
                      onChange={(e) => {
                        setTzTouched((c) => c.map((v, j) => (j === i ? true : v)));
                        patchStore(i, { timezone: e.target.value });
                      }}
                      {...errorProps(tzPath)}
                    />
                    {errorText(tzPath)}
                  </div>
                ) : null}
              </div>
              {draft.stores.length > 1 ? (
                <Button type="button" variant="outline" size="sm" onClick={() => removeStore(i)} aria-label={t('removeStore', { n: i + 1 })}>
                  {t('removeStore', { n: i + 1 })}
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">{t('oneStoreRequired')}</p>
              )}
            </fieldset>
            );
          })}
          {draft.stores.length < MAX_STORES ? (
            <Button id="tn-add-store" type="button" variant="outline" size="sm" onClick={addStore}>{t('addStore')}</Button>
          ) : (
            <p className="text-xs text-muted-foreground">{t('maxStores', { count: MAX_STORES })}</p>
          )}
        </fieldset>

        <p className="text-sm text-muted-foreground">{t('trialSummary', { days: TRIAL_DAYS })}</p>
        <Button type="submit" disabled={provision.isPending} aria-busy={provision.isPending}>
          {provision.isPending ? t('provisioning') : t('provision')}
        </Button>
      </form>
    </div>
  );
}
