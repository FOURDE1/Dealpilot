import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { BackLink } from '../../shared/ui/back-link.js';
import { usePageTitle } from '../../shared/use-page-title.js';
import { Button, Input, Label, Select } from '@dealpilot/ui';
import { BRANDING_DEFAULTS, DarkMode, Density, FontFamily, Radius, type UpdateBrandingInput } from '@dealpilot/schemas';
import { ApiError } from '../../shared/api/client.js';
import { can, usePermissionsMine } from '../../shared/permissions.js';
import {
  useBrandingDraft,
  usePublishBranding,
  useUpdateBranding,
  useUploadBrandAsset,
  type BrandAssetSlot,
  type TenantBrandingT,
} from './api.js';

/** Mirror of packages/schemas BrandColor: a hex or an oklch(L C H). Case-
 *  insensitive to match the server (OKLCH/Oklch are accepted there). */
const BRAND_COLOR = /^(#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})|oklch\(\s*-?[0-9.]+%?\s+-?[0-9.]+\s+-?[0-9.]+\s*\))$/i;

/** A bare hex ('2563EB') is valid to the server; add the '#' for CSS preview. */
function forCss(v: string): string {
  const t = v.trim();
  return /^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(t) ? `#${t}` : t;
}

/** The fonts the schema knows — the select renders the enum, never a local copy. */
const FONTS = FontFamily.options;

interface Draft {
  display_name: string;
  primary_color: string;
  accent_color: string;
  success_color: string;
  danger_color: string;
  font_family: TenantBrandingT['font_family'];
  radius: TenantBrandingT['radius'];
  density: TenantBrandingT['density'];
  dark_mode: TenantBrandingT['dark_mode'];
}

/**
 * The colours the app consumes (D-076). `warning_color` / `info_color` stay
 * in the schema and the table but have no app consumer, so the editor does
 * not offer them — a field nothing paints is the dead-vocabulary bug.
 */
const COLOR_FIELDS = [
  { key: 'primary_color', label: 'colorPrimary', required: true },
  { key: 'accent_color', label: 'colorAccent', required: false, hint: 'colorAccentHint' },
  { key: 'success_color', label: 'colorSuccess', required: false },
  { key: 'danger_color', label: 'colorDanger', required: false },
] as const satisfies readonly { key: keyof Draft; label: string; required: boolean; hint?: string }[];

/**
 * The published-asset slots the shell renders. Byte limits mirror the server's
 * BRANDING_SLOTS (apps/api/src/storage.ts) for an early, local message; the
 * server is the truth (413/415). Dimensions are not validated anywhere (D-076).
 */
const ASSET_SLOTS = [
  { slot: 'logo_light', column: 'logo_light_key', label: 'logoLight', maxKb: 200 },
  { slot: 'logo_dark', column: 'logo_dark_key', label: 'logoDark', maxKb: 200 },
  { slot: 'favicon', column: 'favicon_key', label: 'favicon', maxKb: 100 },
] as const satisfies readonly { slot: BrandAssetSlot; column: keyof TenantBrandingT; label: string; maxKb: number }[];
type AssetSpec = (typeof ASSET_SLOTS)[number];

/** What the asset route accepts (`BRANDING_CONTENT_TYPES`); the input's `accept` and the local pre-check. */
const ASSET_ACCEPT = 'image/png,image/jpeg,image/svg+xml';
const ASSET_TYPES: readonly string[] = ASSET_ACCEPT.split(',');

/**
 * A never-branded org has no draft yet; the editor opens on these. Derived from
 * the SHARED BRANDING_DEFAULTS (CR-16) — the column defaults and this form must
 * be one value, or the editor would open on one colour and save another.
 */
const PLATFORM_DEFAULT: Draft = {
  display_name: '',
  primary_color: BRANDING_DEFAULTS.primary_color,
  accent_color: BRANDING_DEFAULTS.accent_color ?? '',
  success_color: BRANDING_DEFAULTS.success_color ?? '',
  danger_color: BRANDING_DEFAULTS.danger_color ?? '',
  font_family: BRANDING_DEFAULTS.font_family,
  radius: BRANDING_DEFAULTS.radius,
  density: BRANDING_DEFAULTS.density,
  dark_mode: BRANDING_DEFAULTS.dark_mode,
};

function fromBranding(b: TenantBrandingT | null): Draft {
  if (!b) return PLATFORM_DEFAULT;
  return {
    display_name: b.display_name ?? '',
    primary_color: b.primary_color,
    accent_color: b.accent_color ?? '',
    success_color: b.success_color ?? '',
    danger_color: b.danger_color ?? '',
    font_family: b.font_family,
    radius: b.radius,
    density: b.density,
    dark_mode: b.dark_mode,
  };
}

/** The PUT body: only the fields the user changed vs the open-time baseline. */
function diffBranding(form: Draft, base: Draft): UpdateBrandingInput {
  const body: UpdateBrandingInput = {};
  if (form.display_name.trim() !== base.display_name.trim()) {
    body.display_name = form.display_name.trim() === '' ? null : form.display_name.trim();
  }
  for (const c of COLOR_FIELDS) {
    const now = form[c.key].trim();
    if (now !== base[c.key].trim()) {
      if (c.key === 'primary_color') body.primary_color = now;
      else body[c.key] = now === '' ? null : now;
    }
  }
  if (form.font_family !== base.font_family) body.font_family = form.font_family;
  if (form.radius !== base.radius) body.radius = form.radius;
  if (form.density !== base.density) body.density = form.density;
  if (form.dark_mode !== base.dark_mode) body.dark_mode = form.dark_mode;
  return body;
}

/** The PUT that detaches one asset: `{<slot>_key: null}`. */
function removeAssetBody(column: AssetSpec['column']): UpdateBrandingInput {
  switch (column) {
    case 'logo_light_key':
      return { logo_light_key: null };
    case 'logo_dark_key':
      return { logo_dark_key: null };
    case 'favicon_key':
      return { favicon_key: null };
  }
}

/**
 * One asset slot: pick a file, upload it (the draft's key changes and the
 * brand goes back to draft), or detach the current one. Draft assets are not
 * served, so there is no preview — the state line says what the slot holds
 * and whether it is live yet.
 */
function AssetRow({ orgId, spec, draft, disabled }: { orgId: string; spec: AssetSpec; draft: TenantBrandingT | null; disabled: boolean }) {
  const { t } = useTranslation('branding');
  const upload = useUploadBrandAsset(orgId);
  const update = useUpdateBranding(orgId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currentKey = draft?.[spec.column] ?? null;
  // LIVE means the key the floor is served: the one in the PUBLISHED snapshot
  // (the asset route reads the snapshot, not the draft column). The draft's
  // `status` says nothing about it — any unrelated edit puts the draft back to
  // 'draft' while the published logo keeps showing.
  const liveKey = draft?.published_snapshot?.[spec.column] ?? null;
  const busy = disabled || upload.isPending || update.isPending;
  const inputId = `brand-${spec.slot}`;

  async function handleUpload() {
    if (!file) return;
    setError(null);
    if (!ASSET_TYPES.includes(file.type)) {
      setError(t('uploadBadType'));
      return;
    }
    if (file.size > spec.maxKb * 1024) {
      setError(t('uploadTooLarge', { limit: spec.maxKb }));
      return;
    }
    try {
      await upload.mutateAsync({ slot: spec.slot, file });
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setError(
        err.status === 413 ? t('uploadTooLarge', { limit: spec.maxKb }) : err.status === 415 ? t('uploadBadType') : t('uploadError'),
      );
    }
  }

  async function handleRemove() {
    setError(null);
    try {
      await update.mutateAsync(removeAssetBody(spec.column));
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setError(t('genericError'));
    }
  }

  const state = currentKey === null ? t('notUploaded') : currentKey === liveKey ? t('assetLive') : t('uploaded');

  return (
    <div className="space-y-1">
      <Label htmlFor={inputId}>{t(spec.label)}</Label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={ASSET_ACCEPT}
          disabled={busy}
          className="max-w-full text-sm text-foreground file:me-3 file:rounded-md file:border file:border-border file:bg-muted file:px-3 file:py-1.5 file:text-sm file:text-foreground"
          onChange={(e) => {
            setError(null);
            setFile(e.target.files?.[0] ?? null);
          }}
        />
        <Button type="button" variant="outline" size="sm" disabled={busy || file === null} onClick={() => void handleUpload()}>
          {upload.isPending ? t('saving') : t('uploadButton')}
        </Button>
        {currentKey !== null ? (
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void handleRemove()}>
            {t('remove')}
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {state}
      </p>
      {error ? (
        <p role="alert" className="text-xs text-danger-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** F-14 theme editor: set the tenant's brand (draft), see the contrast auto-fixes, publish it live. */
export function BrandingEditorPage() {
  const { t } = useTranslation('branding');
  const { t: tCommon } = useTranslation('common');
  const { orgId = '' } = useParams();
  const mine = usePermissionsMine(orgId);
  const canEdit = can(mine.data, 'organization:update');
  // The whole editor (even reading the draft) needs organization:update, so
  // don't fetch it for someone who can't use it — they get a clear refusal.
  const draft = useBrandingDraft(orgId, { enabled: mine.isSuccess && canEdit });
  const update = useUpdateBranding(orgId);
  const publish = usePublishBranding(orgId);
  usePageTitle(t('title'));

  const [form, setForm] = useState<Draft | null>(null);
  // The values the form OPENED with (Draft shape, so the no-draft defaults and a
  // real draft share one baseline). The save diff compares against this, never
  // the live query — a concurrent edit must not be reverted (store-settings lesson).
  const baseline = useRef<Draft | null>(null);
  const initialized = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    // Loaded once the query settles — data is a draft, or null (never branded).
    if (initialized.current || draft.isPending || draft.isError) return;
    initialized.current = true;
    const opened = fromBranding(draft.data ?? null);
    baseline.current = opened;
    setForm(opened);
  }, [draft.isPending, draft.isError, draft.data]);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }

  const invalidColor = (v: string, required: boolean): boolean =>
    required ? !BRAND_COLOR.test(v.trim()) : v.trim() !== '' && !BRAND_COLOR.test(v.trim());
  const anyInvalid = form !== null && COLOR_FIELDS.some((c) => invalidColor(form[c.key], c.required));
  // Unsaved edits vs the open-time draft. Publish acts on the SAVED draft, so
  // it must be blocked while dirty — otherwise it would ship the old draft live
  // and silently drop the edits.
  const dirty = useMemo(
    () => (form && baseline.current ? Object.keys(diffBranding(form, baseline.current)).length > 0 : false),
    [form],
  );

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const base = baseline.current;
    if (!form || !base || anyInvalid) return;
    const body = diffBranding(form, base);
    if (Object.keys(body).length === 0) {
      setNotice(t('nothingChanged'));
      return;
    }
    try {
      const saved = await update.mutateAsync(body);
      baseline.current = fromBranding(saved);
      setForm(fromBranding(saved));
      setNotice(t('savedDraft'));
    } catch (err) {
      setError(err instanceof ApiError ? t('saveError') : t('genericError'));
      if (!(err instanceof ApiError)) throw err;
    }
  }

  async function handlePublish() {
    setError(null);
    setNotice(null);
    try {
      const published = await publish.mutateAsync();
      baseline.current = fromBranding(published);
      setForm(fromBranding(published));
      setNotice(t('published', { version: published.version }));
    } catch (err) {
      setError(err instanceof ApiError ? t('publishError') : t('genericError'));
      if (!(err instanceof ApiError)) throw err;
    }
  }

  // Resolve permissions first — the whole editor is organization:update-gated.
  if (mine.isPending) {
    return <p className="text-sm text-muted-foreground" aria-busy="true">{t('loading')}</p>;
  }
  if (mine.isError) {
    return <p role="alert" className="text-sm text-danger-text">{t('loadError')}</p>;
  }
  // A member without the right sees the published brand in the app, but cannot
  // open the editor — its endpoints (even reading the draft) need the right.
  if (!canEdit) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <BackLink to={`/organizations/${orgId}`}>{t('back')}</BackLink>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          {t('notAllowed')}
        </p>
      </div>
    );
  }
  if (draft.isPending || !form) {
    return <p className="text-sm text-muted-foreground" aria-busy="true">{t('loading')}</p>;
  }
  if (draft.isError) {
    return <p role="alert" className="text-sm text-danger-text">{t('loadError')}</p>;
  }

  const adjustments = draft.data?.contrast_adjustments ?? [];
  const busy = update.isPending || publish.isPending;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <BackLink to={`/organizations/${orgId}`}>{t('back')}</BackLink>
      <header>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      <form onSubmit={(e) => void handleSave(e)} className="space-y-5 rounded-lg border border-border bg-card p-6" noValidate>
        <div className="space-y-1">
          <Label htmlFor="brand-name">{t('displayName')}</Label>
          <Input
            id="brand-name"
            value={form.display_name}
            maxLength={120}
            onChange={(e) => set('display_name', e.target.value)}
          />
          <p className="text-xs text-muted-foreground">{t('displayNameHint')}</p>
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">{t('colorsLegend')}</legend>
          <p className="text-xs text-muted-foreground">{t('colorsHint')}</p>
          {COLOR_FIELDS.map((c) => {
            const value = form[c.key];
            const bad = invalidColor(value, c.required);
            const swatch = !bad && value.trim() !== '' ? forCss(value) : undefined;
            const hint = 'hint' in c ? c.hint : undefined;
            return (
              <div key={c.key} className="flex items-end gap-3">
                <span
                  aria-hidden="true"
                  className="mb-0.5 size-9 shrink-0 rounded-md border border-border"
                  style={swatch ? { backgroundColor: swatch } : undefined}
                />
                <div className="flex-1 space-y-1">
                  <Label htmlFor={`brand-${c.key}`} optionalText={c.required ? undefined : tCommon('optional')}>
                    {t(c.label)}
                  </Label>
                  <Input
                    id={`brand-${c.key}`}
                    value={value}
                    placeholder="#2563EB"
                    aria-invalid={bad || undefined}
                    aria-describedby={bad ? `brand-${c.key}-error` : hint ? `brand-${c.key}-hint` : undefined}
                    className={bad ? 'border-danger-border font-mono' : 'font-mono'}
                    onChange={(e) => set(c.key, e.target.value)}
                  />
                  {bad ? (
                    <p id={`brand-${c.key}-error`} role="alert" className="text-xs text-danger-text">
                      {t('invalidColor')}
                    </p>
                  ) : hint ? (
                    <p id={`brand-${c.key}-hint`} className="text-xs text-muted-foreground">
                      {t(hint)}
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">{t('assetsLegend')}</legend>
          <p className="text-xs text-muted-foreground">{t('assetsHint')}</p>
          {ASSET_SLOTS.map((spec) => (
            <AssetRow key={spec.slot} orgId={orgId} spec={spec} draft={draft.data ?? null} disabled={busy} />
          ))}
        </fieldset>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="brand-font">{t('font')}</Label>
            <Select id="brand-font" value={form.font_family} onChange={(e) => set('font_family', e.target.value as Draft['font_family'])}>
              {FONTS.map((f) => (
                <option key={f} value={f}>{t(`font_${f}`)}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="brand-radius">{t('radius')}</Label>
            <Select id="brand-radius" value={form.radius} onChange={(e) => set('radius', e.target.value as Draft['radius'])}>
              {Radius.options.map((r) => (
                <option key={r} value={r}>{t(`radius_${r}`)}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="brand-density">{t('density')}</Label>
            <Select
              id="brand-density"
              value={form.density}
              aria-describedby="brand-density-hint"
              onChange={(e) => set('density', e.target.value as Draft['density'])}
            >
              {Density.options.map((d) => (
                <option key={d} value={d}>{t(`density_${d}`)}</option>
              ))}
            </Select>
            <p id="brand-density-hint" className="text-xs text-muted-foreground">{t('densityHint')}</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="brand-dark">{t('darkMode')}</Label>
            <Select
              id="brand-dark"
              value={form.dark_mode}
              aria-describedby="brand-dark-hint"
              onChange={(e) => set('dark_mode', e.target.value as Draft['dark_mode'])}
            >
              {DarkMode.options.map((d) => (
                <option key={d} value={d}>{t(`dark_${d}`)}</option>
              ))}
            </Select>
            <p id="brand-dark-hint" className="text-xs text-muted-foreground">{t('darkDisabledHint')}</p>
          </div>
        </div>

        {adjustments.length > 0 ? (
          <div className="space-y-1 rounded-md bg-warning-bg px-3 py-2">
            <p className="text-sm font-medium text-warning-text">{t('adjustmentsTitle')}</p>
            <ul className="space-y-0.5 text-xs text-warning-text">
              {adjustments.map((a, i) => (
                <li key={`${a.token}-${i}`}>
                  {t('adjustmentRow', {
                    token: a.token,
                    before: a.ratioBefore.toFixed(1),
                    after: a.ratioAfter.toFixed(1),
                  })}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {error ? <p role="alert" className="text-sm text-danger-text">{error}</p> : null}
        {notice ? <p role="status" className="text-sm font-medium text-success-text">{notice}</p> : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || anyInvalid}>
            {update.isPending ? t('saving') : t('saveDraft')}
          </Button>
          {/* Publish acts on the SAVED draft — blocked with no draft yet, or
              while there are unsaved edits (it would ship the old draft). */}
          <Button
            type="button"
            variant="outline"
            disabled={busy || !draft.data || dirty}
            onClick={() => void handlePublish()}
          >
            {publish.isPending ? t('publishing') : t('publish')}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {!draft.data ? t('saveFirstHint') : dirty ? t('saveBeforePublish') : t('publishHint')}
        </p>
      </form>
    </div>
  );
}
