import { useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Input, Label, Select } from '@dealpilot/ui';
import {
  AnnouncementSeverity,
  PlanTier,
  type AnnouncementAudienceT,
  type AnnouncementSeverityT,
  type PlanTierT,
  type PublishAnnouncementInputT,
} from '@dealpilot/schemas';
import { ANNOUNCEMENT_TEXT_FIELDS, MARKETING_SUPPRESSED_STATUSES, missingTranslations } from '@dealpilot/core';
import { BackLink } from '../../shared/ui/back-link.js';
import { usePageTitle } from '../../shared/use-page-title.js';
import { ApiError } from '../../shared/api/client.js';
import { SEVERITY_KEYS } from '../announcements/labels.js';
import { useAdminTenants, usePublishAnnouncement } from './api.js';
import { STATUS_KEYS, TIER_KEYS } from './labels.js';

/**
 * F-72 — publishing an announcement (admin-console.md §8, §12).
 *
 * Publishing IS creating: there is no draft to save, no amend and no delete,
 * so everything on this form is decided once, and the publisher has to see
 * the consequences BEFORE they press it. Three are therefore said while they
 * type rather than after:
 *
 *  - which of the four bilingual fields are still empty (Bill 96), from the
 *    same `missingTranslations()` the server's 422 uses, so the refusal is a
 *    last resort rather than the first time they learn the rule;
 *  - which tenants a `marketing` notice is withheld from, named from the same
 *    `MARKETING_SUPPRESSED_STATUSES` the SQL predicate filters on, which is
 *    the difference between "nobody saw it" and "it worked";
 *  - that a maintenance or incident notice cannot be dismissed.
 */

const TEXTAREA_CLASSES =
  'w-full rounded-md border border-input bg-input-bg px-3 py-2 text-sm text-foreground ' +
  'outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

/** What a refusal calls the field, in words (H-04) — never the wire path. */
const FIELD_LABEL = {
  severity: 'fieldSeverity',
  title_en: 'fieldTitleEn',
  title_fr: 'fieldTitleFr',
  body_en: 'fieldBodyEn',
  body_fr: 'fieldBodyFr',
  audience: 'fieldAudience',
  starts_at: 'fieldStartsAt',
  ends_at: 'fieldEndsAt',
  status_incident_url: 'fieldIncidentUrl',
} as const;

type AudienceType = AnnouncementAudienceT['type'];

interface Draft {
  severity: AnnouncementSeverityT;
  title_en: string;
  title_fr: string;
  body_en: string;
  body_fr: string;
  audienceType: AudienceType;
  plan_codes: PlanTierT[];
  organization_ids: string[];
  starts_at: string;
  ends_at: string;
  status_incident_url: string;
}

const EMPTY: Draft = {
  severity: 'info',
  title_en: '',
  title_fr: '',
  body_en: '',
  body_fr: '',
  audienceType: 'all',
  plan_codes: [],
  organization_ids: [],
  starts_at: '',
  ends_at: '',
  status_incident_url: '',
};

/** `2026-08-30T14:05` from a datetime-local input to the wire's ISO instant. */
function isoOf(local: string): string | undefined {
  if (!local) return undefined;
  const at = new Date(local);
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}

function audienceOf(draft: Draft): AnnouncementAudienceT {
  if (draft.audienceType === 'plan') return { type: 'plan', plan_codes: draft.plan_codes };
  if (draft.audienceType === 'organizations') return { type: 'organizations', organization_ids: draft.organization_ids };
  return { type: 'all' };
}

/**
 * The third audience arm names organizations, so the publisher has to be able
 * to find them. Chosen tenants are listed above the search and stay listed
 * once the search moves on — a selection that scrolls out of sight is how an
 * announcement goes to the wrong dealer.
 */
function TenantPicker({
  chosen,
  onChange,
}: {
  chosen: string[];
  onChange: (ids: string[]) => void;
}) {
  const { t: tAdmin } = useTranslation('admin');
  const [search, setSearch] = useState('');
  // Names are remembered as they are picked; the directory page they came
  // from is filtered away the moment the search changes.
  const [names, setNames] = useState<Record<string, string>>({});
  const tenants = useAdminTenants({ q: search || undefined });
  const rows = (tenants.data?.pages.flatMap((p) => p.items) ?? []).filter((tenant) => !chosen.includes(tenant.id));

  const row = (id: string, name: string, picked: boolean) => (
    <li key={id}>
      <label htmlFor={`ann-org-${id}`} className="flex min-h-11 items-center gap-2 text-sm">
        <input
          id={`ann-org-${id}`}
          type="checkbox"
          className="size-4"
          checked={picked}
          onChange={(e) => {
            setNames((n) => ({ ...n, [id]: name }));
            onChange(e.target.checked ? [...chosen, id] : chosen.filter((other) => other !== id));
          }}
        />
        <span>{name}</span>
      </label>
    </li>
  );

  return (
    <div className="space-y-2">
      {chosen.length > 0 ? <ul className="space-y-1">{chosen.map((id) => row(id, names[id] ?? id, true))}</ul> : null}
      <div className="space-y-1">
        <Label htmlFor="ann-tenant-q">{tAdmin('searchLabel')}</Label>
        <Input id="ann-tenant-q" type="search" maxLength={80} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <ul className="max-h-64 space-y-1 overflow-y-auto">{rows.map((tenant) => row(tenant.id, tenant.name, false))}</ul>
    </div>
  );
}

export function AnnouncementComposePage() {
  const { t } = useTranslation('announcements');
  const { t: tAdmin } = useTranslation('admin');
  const { t: tOrgs } = useTranslation('orgs');
  usePageTitle(t('composeTitle'));
  const navigate = useNavigate();
  const publish = usePublishAnnouncement();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const gaps = missingTranslations(draft);
  // Read off the constant the `announcement_matches` predicate is pinned to,
  // never retyped: the day a fourth status is suppressed the publisher is told
  // about it instead of reading a promise the database stopped keeping.
  const suppressedStatuses = MARKETING_SUPPRESSED_STATUSES.map((s) => tOrgs(STATUS_KEYS[s])).join(', ');
  const labelFor = (path: string): string =>
    Object.prototype.hasOwnProperty.call(FIELD_LABEL, path) ? t(FIELD_LABEL[path as keyof typeof FIELD_LABEL]) : path;

  /** The server's refusal in the publisher's words, keyed by detail code. */
  const messageFor = (code: string | undefined, path: string): string =>
    code === 'missing_translation' ? t('bothLanguages') : tAdmin('invalidField', { field: labelFor(path) });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setAlert(null);
    setFieldErrors({});
    // The rules worth checking while the person is still looking at the form;
    // everything else is the server's, and its answer marks the field.
    const errors: Record<string, string> = {};
    for (const field of gaps) errors[field] = t('bothLanguages');
    if (draft.audienceType === 'plan' && draft.plan_codes.length === 0) {
      errors['audience'] = tAdmin('required', { field: t('fieldAudience') });
    }
    if (draft.audienceType === 'organizations' && draft.organization_ids.length === 0) {
      errors['audience'] = tAdmin('required', { field: t('fieldAudience') });
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setAlert(tAdmin('fixErrors'));
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    const startsAt = isoOf(draft.starts_at);
    const endsAt = isoOf(draft.ends_at);
    const body: PublishAnnouncementInputT = {
      severity: draft.severity,
      title_en: draft.title_en.trim(),
      title_fr: draft.title_fr.trim(),
      body_en: draft.body_en.trim(),
      body_fr: draft.body_fr.trim(),
      audience: audienceOf(draft),
      ...(startsAt ? { starts_at: startsAt } : {}),
      ...(endsAt ? { ends_at: endsAt } : {}),
      // The schema is strict and the CHECK is biconditional: the link belongs
      // to an incident and to nothing else.
      ...(draft.severity === 'incident' ? { status_incident_url: draft.status_incident_url.trim() } : {}),
    };
    try {
      const created = await publish.mutateAsync(body);
      navigate(`/admin/announcements/${created.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        // Every refused field at once (WCAG 3.3.1), not one per round trip.
        const paths = err.detailPaths?.length ? err.detailPaths : err.fieldPath ? [err.fieldPath] : [];
        const fromServer: Record<string, string> = {};
        paths.forEach((path, i) => {
          if (path && !fromServer[path]) fromServer[path] = messageFor(err.detailCodes?.[i] ?? err.code, path);
        });
        setFieldErrors(fromServer);
        setAlert(tAdmin('fixErrors'));
      } else if (err instanceof ApiError && err.status === 403) {
        // §3: support publishes `info`; anything louder is a super admin's.
        // Marking the field alone ("Field refused: Severity") never states the
        // rule, so the publisher's next move is to send the same severity again.
        setFieldErrors({ severity: t('severityForbidden') });
        setAlert(tAdmin('fixErrors'));
      } else {
        setAlert(tAdmin('saveError'));
      }
      requestAnimationFrame(() => summaryRef.current?.focus());
    }
  };

  const errorText = (path: string) => {
    const message = fieldErrors[path];
    return message ? <p id={`ann-${path}-error`} role="alert" className="text-xs text-danger-text">{message}</p> : null;
  };
  const errorProps = (path: string) =>
    fieldErrors[path] ? { 'aria-invalid': true as const, 'aria-describedby': `ann-${path}-error` } : {};

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <BackLink to="/admin/announcements">{tAdmin('backToAnnouncements')}</BackLink>
      <h1 className="text-2xl font-semibold">{t('composeTitle')}</h1>

      {alert ? (
        <div
          ref={summaryRef}
          tabIndex={-1}
          role="alert"
          className="space-y-1 rounded-md border border-danger-border px-3 py-2 text-sm text-danger-text outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <p>{alert}</p>
          {Object.keys(fieldErrors).length > 0 ? (
            <ul className="list-disc ps-5">
              {Object.entries(fieldErrors).map(([path, message]) => (
                <li key={path}>
                  <a href={`#ann-${path}`} className="underline underline-offset-4">{labelFor(path)} — {message}</a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <form onSubmit={(e) => void submit(e)} noValidate className="space-y-6">
        <fieldset className="space-y-3 rounded-lg border border-border bg-card p-4">
          <legend className="px-1 text-[15px] font-semibold">{t('fieldSeverity')}</legend>
          <Select
            id="ann-severity"
            aria-label={t('fieldSeverity')}
            value={draft.severity}
            onChange={(e) => patch({ severity: e.target.value as AnnouncementSeverityT })}
            {...errorProps('severity')}
          >
            {AnnouncementSeverity.options.map((s) => (
              <option key={s} value={s}>{t(SEVERITY_KEYS[s])}</option>
            ))}
          </Select>
          {errorText('severity')}
          {draft.severity === 'marketing' ? (
            <p className="text-sm text-muted-foreground">{t('marketingSuppressed', { statuses: suppressedStatuses })}</p>
          ) : null}
          {draft.severity === 'maintenance' || draft.severity === 'incident' ? (
            <p className="text-sm text-muted-foreground">{t('nonDismissible')}</p>
          ) : null}
          {draft.severity === 'incident' ? (
            <div className="space-y-1">
              <Label htmlFor="ann-status_incident_url">{t('fieldIncidentUrl')}</Label>
              <Input
                id="ann-status_incident_url"
                type="url"
                maxLength={512}
                inputMode="url"
                placeholder="https://"
                value={draft.status_incident_url}
                onChange={(e) => patch({ status_incident_url: e.target.value })}
                {...errorProps('status_incident_url')}
              />
              {errorText('status_incident_url')}
            </div>
          ) : null}
        </fieldset>

        <fieldset className="space-y-3 rounded-lg border border-border bg-card p-4">
          <legend className="px-1 text-[15px] font-semibold">{t('bothLanguages')}</legend>
          {/* Live, and in words: which of the four are still empty, from the
              same helper the server refuses with. */}
          <p aria-live="polite" className={`text-xs ${gaps.length > 0 ? 'text-warning-text' : 'sr-only'}`}>
            {gaps.length > 0 ? t('stillMissing', { fields: gaps.map((f) => t(FIELD_LABEL[f])).join(', ') }) : ''}
          </p>
          {ANNOUNCEMENT_TEXT_FIELDS.map((field) => (
            <div key={field} className="space-y-1">
              <Label htmlFor={`ann-${field}`}>{t(FIELD_LABEL[field])}</Label>
              {field === 'title_en' || field === 'title_fr' ? (
                <Input
                  id={`ann-${field}`}
                  maxLength={120}
                  value={draft[field]}
                  onChange={(e) => patch({ [field]: e.target.value })}
                  {...errorProps(field)}
                />
              ) : (
                <textarea
                  id={`ann-${field}`}
                  rows={3}
                  maxLength={2000}
                  className={TEXTAREA_CLASSES}
                  value={draft[field]}
                  onChange={(e) => patch({ [field]: e.target.value })}
                  {...errorProps(field)}
                />
              )}
              {errorText(field)}
            </div>
          ))}
        </fieldset>

        <fieldset className="space-y-3 rounded-lg border border-border bg-card p-4">
          <legend className="px-1 text-[15px] font-semibold">{t('fieldAudience')}</legend>
          <Select
            id="ann-audience"
            aria-label={t('fieldAudience')}
            value={draft.audienceType}
            onChange={(e) => patch({ audienceType: e.target.value as AudienceType, plan_codes: [], organization_ids: [] })}
            {...errorProps('audience')}
          >
            <option value="all">{t('audience_all')}</option>
            <option value="plan">{t('audience_plan')}</option>
            <option value="organizations">{t('audience_organizations')}</option>
          </Select>
          {draft.audienceType === 'plan' ? (
            <ul className="space-y-1">
              {PlanTier.options.map((code) => (
                <li key={code}>
                  <label htmlFor={`ann-plan-${code}`} className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      id={`ann-plan-${code}`}
                      type="checkbox"
                      className="size-4"
                      checked={draft.plan_codes.includes(code)}
                      onChange={(e) =>
                        patch({ plan_codes: e.target.checked ? [...draft.plan_codes, code] : draft.plan_codes.filter((c) => c !== code) })
                      }
                    />
                    <span>{tOrgs(TIER_KEYS[code])}</span>
                  </label>
                </li>
              ))}
            </ul>
          ) : null}
          {draft.audienceType === 'organizations' ? (
            <TenantPicker chosen={draft.organization_ids} onChange={(ids) => patch({ organization_ids: ids })} />
          ) : null}
          {errorText('audience')}
        </fieldset>

        <fieldset className="space-y-3 rounded-lg border border-border bg-card p-4">
          <legend className="px-1 text-[15px] font-semibold">{t('colWindow')}</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ann-starts_at" optionalText={tAdmin('optional')}>{t('fieldStartsAt')}</Label>
              <Input
                id="ann-starts_at"
                type="datetime-local"
                value={draft.starts_at}
                onChange={(e) => patch({ starts_at: e.target.value })}
                {...errorProps('starts_at')}
              />
              {errorText('starts_at')}
            </div>
            <div className="space-y-1">
              <Label htmlFor="ann-ends_at">{t('fieldEndsAt')}</Label>
              <Input
                id="ann-ends_at"
                type="datetime-local"
                value={draft.ends_at}
                onChange={(e) => patch({ ends_at: e.target.value })}
                {...errorProps('ends_at')}
              />
              {errorText('ends_at')}
            </div>
          </div>
        </fieldset>

        <Button type="submit" disabled={publish.isPending} aria-busy={publish.isPending}>
          {publish.isPending ? t('publishing') : t('publish')}
        </Button>
      </form>
    </div>
  );
}
