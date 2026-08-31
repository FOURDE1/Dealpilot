import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Label, Select } from '@dealpilot/ui';
import { ProvinceCA, type AdminActivityEventT, type AdminTenantDetailT, type OrganizationStatusT, type PlanTierT, type RoleT } from '@dealpilot/schemas';
import { BackLink } from '../../shared/ui/back-link.js';
import { usePageTitle } from '../../shared/use-page-title.js';
import { ApiError } from '../../shared/api/client.js';
import { useAdminMe, useAdminPlans, useAdminTenant, useAdminTenantEvents, useUpdateAdminTenant } from './api.js';
import {
  DESTRUCTIVE_TARGETS, END_REASON_KEYS, MODE_KEYS, STATUS_CLASSES, STATUS_KEYS, STORE_STATUS_KEYS, TIER_KEYS, TRANSITION_KEYS,
} from './labels.js';
import { StatusTransitionDialog } from './status-transition-dialog.js';
import { ReissueOwnerDialog } from './reissue-owner-dialog.js';
import { StartImpersonationDialog } from './start-impersonation-dialog.js';
import { ACTION_KEYS } from '../activity/activity-timeline.js';
import { ENTITY_KEYS } from './labels.js';

/**
 * F-69 — one tenant (admin-console.md §4): the facts, the profile a super
 * admin may edit (billing: the plan only), the lifecycle buttons the server
 * said this caller may press, and the journal — every platform act on the
 * organization, restricted rows included, each change spelled out as
 * from → to in the reader's words.
 */

interface Draft {
  name: string;
  legal_name: string;
  province: string;
  privacy_officer_name: string;
  privacy_officer_email: string;
  default_locale: 'fr-CA' | 'en-CA';
  plan_id: string;
  reason: string;
}

function draftOf(t: AdminTenantDetailT): Draft {
  return {
    name: t.name,
    legal_name: t.legal_name ?? '',
    province: t.province ?? '',
    privacy_officer_name: t.privacy_officer_name ?? '',
    privacy_officer_email: t.privacy_officer_email ?? '',
    default_locale: t.default_locale,
    plan_id: t.plan_id,
    reason: '',
  };
}

const FIELD_LABEL = {
  name: 'name',
  legal_name: 'legalName',
  province: 'province',
  privacy_officer_name: 'privacyOfficer',
  privacy_officer_email: 'privacyOfficerEmail',
  default_locale: 'locale',
  plan_id: 'plan',
  plan_tier: 'plan',
  slug: 'colSlug',
  trial_ends_at: 'trialEndsAt',
  email: 'email',
  roles: 'rolesLabel',
  reissued: 'reissuedLabel',
  // F-71 session rows.
  mode: 'colMode',
  target_email: 'colActingAs',
  expires_at: 'colEnds',
  ticket_ref: 'impersonateTicket',
  end_reason: 'colEndReason',
} as const;

export function TenantDetailPage() {
  const { t, i18n } = useTranslation('admin');
  const { t: tOrgs } = useTranslation('orgs');
  const { t: tActivity } = useTranslation('activity');
  const { t: tTeam } = useTranslation('team');
  const { t: tSnapshot } = useTranslation('snapshot');
  const { tenantId = '' } = useParams();
  const tenant = useAdminTenant(tenantId);
  const events = useAdminTenantEvents(tenantId);
  const plans = useAdminPlans();
  const me = useAdminMe();
  const update = useUpdateAdminTenant(tenantId);
  usePageTitle(tenant.data?.name);
  const alive = tenant.data?.deleted_at === null;
  const canEdit = alive && (me.data?.capabilities.includes('tenants:update') ?? false);
  const canPlan = alive && (me.data?.capabilities.includes('tenants:set_plan') ?? false);
  // F-70: the seat is the console's to re-issue only while nobody holds it.
  const canReissue = alive && (me.data?.capabilities.includes('tenants:create') ?? false) && (tenant.data?.owner_emails.length ?? 1) === 0;
  const [reissueOpen, setReissueOpen] = useState(false);
  const [acceptUrl, setAcceptUrl] = useState<string | null>(null);
  // F-71: a support session can be opened on a tenant that has standing (the
  // server refuses the rest); the picker and the dialog are the door.
  const canImpersonate =
    alive &&
    (me.data?.capabilities.includes('impersonation:start_read_only') ?? false) &&
    ['active', 'trial', 'past_due', 'read_only'].includes(tenant.data?.status ?? '');
  const [impersonateOpen, setImpersonateOpen] = useState(false);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'status' | 'alert'; text: string } | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [transition, setTransition] = useState<OrganizationStatusT | null>(null);
  const [planConfirm, setPlanConfirm] = useState<Record<string, unknown> | null>(null);
  const [lastChange, setLastChange] = useState<string | null>(null);
  const lastChangeRef = useRef<HTMLParagraphElement>(null);
  // Populate ONCE per tenant — a background refetch must never clobber edits.
  const initializedFor = useRef<string | null>(null);
  useEffect(() => {
    if (tenant.data && initializedFor.current !== tenant.data.id) {
      initializedFor.current = tenant.data.id;
      setDraft(draftOf(tenant.data));
    }
  }, [tenant.data]);

  const fmt = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : t('never');

  const send = async (body: Record<string, unknown>) => {
    setFeedback(null);
    setFieldError(null);
    try {
      const saved = await update.mutateAsync(body as Parameters<typeof update.mutateAsync>[0]);
      setDraft(draftOf(saved));
      setFeedback({ kind: 'status', text: t('saved') });
    } catch (err) {
      if (err instanceof ApiError && err.fieldPath) setFieldError(err.fieldPath);
      setFeedback({ kind: 'alert', text: t('saveError') });
    }
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!draft || !tenant.data) return;
    const d = tenant.data;
    const body: Record<string, unknown> = {};
    if (canEdit) {
      if (draft.name.trim() !== d.name) body['name'] = draft.name.trim();
      if ((draft.legal_name.trim() || null) !== d.legal_name) body['legal_name'] = draft.legal_name.trim() || null;
      if ((draft.province || null) !== d.province) body['province'] = draft.province || null;
      if ((draft.privacy_officer_name.trim() || null) !== d.privacy_officer_name) body['privacy_officer_name'] = draft.privacy_officer_name.trim() || null;
      if ((draft.privacy_officer_email.trim() || null) !== d.privacy_officer_email) body['privacy_officer_email'] = draft.privacy_officer_email.trim() || null;
      if (draft.default_locale !== d.default_locale) body['default_locale'] = draft.default_locale;
    }
    const planChanged = canPlan && draft.plan_id !== d.plan_id;
    if (planChanged) body['plan_id'] = draft.plan_id;
    if (Object.keys(body).length === 0) return;
    if (draft.reason.trim()) body['reason'] = draft.reason.trim();
    // A plan change moves the tenant's entitlements: it is confirmed in the
    // same dialog vocabulary as every other audited act here, not a browser prompt.
    if (planChanged) setPlanConfirm(body);
    else void send(body);
  };

  const fieldErrorId = fieldError ? 'tenant-field-error' : undefined;
  const invalid = (field: string) => (fieldError === field ? { 'aria-invalid': true as const, 'aria-describedby': fieldErrorId } : {});

  const renderChange = (ev: AdminActivityEventT, d: AdminTenantDetailT) => {
    const entries = Object.entries(ev.changes) as [string, { from?: unknown; to?: unknown }][];
    // The verb and the entity are on the row already; no changes = nothing more to say.
    if (entries.length === 0) return null;
    const label = (key: string) => (key in FIELD_LABEL ? t(FIELD_LABEL[key as keyof typeof FIELD_LABEL]) : key);
    const value = (key: string, v: unknown): string => {
      if (v === null || v === undefined || v === '') return '—';
      // `status` is the tenant lifecycle on an organization row; on a support
      // session row it is active → ended (F-71) — never the tenant's label.
      if (key === 'status' && ev.entity_type === 'organization') return tOrgs(STATUS_KEYS[v as OrganizationStatusT] ?? STATUS_KEYS[d.status]);
      if (key === 'status' && ev.entity_type === 'impersonation_session') return t(v === 'ended' ? 'sessionEnded' : 'activeNow');
      if (key === 'mode' && typeof v === 'string' && v in MODE_KEYS) return t(MODE_KEYS[v as keyof typeof MODE_KEYS]);
      if (key === 'end_reason' && typeof v === 'string' && v in END_REASON_KEYS) return t(END_REASON_KEYS[v as keyof typeof END_REASON_KEYS]);
      if (key === 'plan_tier') return tOrgs(TIER_KEYS[v as PlanTierT] ?? TIER_KEYS.core);
      if (key === 'plan_id' && typeof v === 'string') return plans.data?.items.find((p) => p.id === v)?.name ?? v;
      // Roles in a trail row are the tenant vocabulary (0001 CHECK): the cast names that.
      if (key === 'roles' && Array.isArray(v)) return v.map((r) => tTeam(`role_${r as RoleT}`)).join(', ');
      if (typeof v === 'boolean') return t(v ? 'yes' : 'no');
      if (key.endsWith('_at') && typeof v === 'string') return fmt(v);
      if (Array.isArray(v)) return v.map(String).join(', ');
      return String(v);
    };
    // A profile update carries plan_id AND plan_tier (one fact twice); the
    // birth row carries plan_id alone, resolved to the plan's name above.
    const twice = 'plan_tier' in ev.changes;
    // F-70's birth rows mix {from,to} diffs with plain facts (`email`,
    // `reissued`): a fact is shown as itself, not as "— → —".
    const isDiff = (c: unknown): c is { from?: unknown; to?: unknown } =>
      c !== null && typeof c === 'object' && !Array.isArray(c) && ('from' in c || 'to' in c);
    return (
      <ul className="space-y-0.5">
        {entries
          .filter(([key]) => key !== 'plan_id' || !twice)
          .map(([key, change]) => (
            <li key={key}>
              <span className="text-muted-foreground">{label(key)}</span>
              {': '}
              {isDiff(change) ? <>{value(key, change.from)} → {value(key, change.to)}</> : value(key, change)}
            </li>
          ))}
      </ul>
    );
  };

  if (tenant.isPending) return <p aria-busy="true" className="text-sm text-muted-foreground">{t('loading')}</p>;
  if (tenant.isError || !tenant.data) return <p role="alert" className="text-sm text-danger-text">{t('loadError')}</p>;
  const d = tenant.data;

  return (
    <div className="space-y-6">
      <BackLink to="/admin/tenants">{t('back')}</BackLink>
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{d.name}</h1>
        <span className="font-mono text-xs text-muted-foreground">{d.slug}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_CLASSES[d.status]}`}>{tOrgs(STATUS_KEYS[d.status])}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{tOrgs(TIER_KEYS[d.plan_code])}</span>
        {d.deleted_at ? <span className="rounded-full bg-danger-bg px-2 py-0.5 text-xs text-danger-text">{t('deletedTenant')}</span> : null}
        {/* F-73 §6 / F-77: usage and the snapshot answer questions about a
            tenant already open, so they hang off this page rather than taking
            console nav slots. The snapshot link reuses its page's title key
            (D-077 (4)): a renamed page renames its link. */}
        <div className="ms-auto flex flex-wrap items-center gap-4">
          <Link to={`/admin/tenants/${d.id}/usage`} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">
            {t('navUsage')}
          </Link>
          <Link to={`/admin/tenants/${d.id}/snapshot`} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">
            {tSnapshot('title')}
          </Link>
        </div>
      </header>
      <p
        ref={lastChangeRef}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        className={`text-sm text-muted-foreground outline-none ${lastChange ? '' : 'sr-only'}`}
      >
        {lastChange ?? ''}
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section aria-labelledby="facts" className="space-y-2 rounded-lg border border-border bg-card p-4">
          <h2 id="facts" className="text-[15px] font-semibold">{t('factsTitle')}</h2>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
            <dt className="text-muted-foreground">{t('legalName')}</dt><dd>{d.legal_name ?? '—'}</dd>
            <dt className="text-muted-foreground">{t('province')}</dt><dd>{d.province ?? '—'}</dd>
            <dt className="text-muted-foreground">{t('locale')}</dt><dd>{d.default_locale}</dd>
            <dt className="text-muted-foreground">{t('stripeCustomer')}</dt><dd>{d.stripe_customer_id ?? t('noStripe')}</dd>
            <dt className="text-muted-foreground">{t('privacyOfficer')}</dt><dd>{d.privacy_officer_name ?? '—'}</dd>
            <dt className="text-muted-foreground">{t('privacyOfficerEmail')}</dt><dd>{d.privacy_officer_email ?? '—'}</dd>
            <dt className="text-muted-foreground">{t('colCreated')}</dt><dd>{fmt(d.created_at)}</dd>
            <dt className="text-muted-foreground">{t('activatedAt')}</dt><dd>{fmt(d.activated_at)}</dd>
            <dt className="text-muted-foreground">{t('trialEndsAt')}</dt>
            <dd>{d.trial_ends_at ? `${fmt(d.trial_ends_at)}${d.status === 'trial' && new Date(d.trial_ends_at).getTime() < Date.now() ? ` ${t('trialEnded')}` : ''}` : '—'}</dd>
            <dt className="text-muted-foreground">{t('suspendedAt')}</dt><dd>{fmt(d.suspended_at)}</dd>
            <dt className="text-muted-foreground">{t('lastActivity')}</dt><dd>{fmt(d.last_activity_at)}</dd>
            <dt className="text-muted-foreground">{t('colMembers')}</dt><dd>{d.member_count}</dd>
            <dt className="text-muted-foreground">{t('owners')}</dt><dd>{d.owner_emails.join(', ') || '—'}</dd>
            {d.owner_emails.length === 0 && d.owner_invitation ? (
              <>
                <dt className="text-muted-foreground">{t('ownerInvited')}</dt>
                <dd>
                  {d.owner_invitation.email}
                  <span className="block text-xs text-muted-foreground">
                    {d.owner_invitation.expired ? t('invitationExpired') : t('invitationExpires', { date: fmt(d.owner_invitation.expires_at) })}
                  </span>
                </dd>
              </>
            ) : null}
          </dl>
          {canReissue ? (
            <div className="space-y-2 pt-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setReissueOpen(true)}>{t('reissueInvite')}</Button>
              {acceptUrl ? (
                <div className="space-y-1">
                  <p className="text-sm text-warning-text">{t('acceptUrlHint')}</p>
                  <Label htmlFor="tenant-accept-url">{t('acceptUrlLabel')}</Label>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input id="tenant-accept-url" readOnly value={acceptUrl} className="min-w-64 flex-1 font-mono text-[12px]" onFocus={(e) => e.target.select()} />
                    <Button type="button" variant="outline" size="sm" onClick={() => { void navigator.clipboard.writeText(acceptUrl).then(() => setLastChange(t('copied'))); }}>{t('copyLink')}</Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          <h3 className="pt-2 text-sm font-semibold">{t('storesTitle')}</h3>
          {d.stores.length === 0 ? (
            <p className="text-sm text-muted-foreground">—</p>
          ) : (
            <ul className="text-sm">
              {d.stores.map((s) => (
                <li key={s.id} className="flex justify-between gap-3 py-1">
                  <span>{s.name} <span className="font-mono text-xs text-muted-foreground">{s.code}</span></span>
                  <span className="text-muted-foreground">{s.province} · {t(STORE_STATUS_KEYS[s.status])}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="lifecycle" className="space-y-3 rounded-lg border border-border bg-card p-4">
          <h2 id="lifecycle" className="text-[15px] font-semibold">{t('lifecycleTitle')}</h2>
          {d.allowed_transitions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{d.deleted_at ? t('deletedTenantHint') : t('transitionsRestricted')}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {d.allowed_transitions.map((to) => (
                <Button
                  key={to}
                  type="button"
                  size="sm"
                  variant={DESTRUCTIVE_TARGETS.has(to) ? 'destructive' : 'outline'}
                  onClick={() => setTransition(to)}
                >
                  {t(TRANSITION_KEYS[to])}
                </Button>
              ))}
            </div>
          )}
        </section>

        {canImpersonate ? (
          <section aria-labelledby="support" className="space-y-3 rounded-lg border border-border bg-card p-4">
            <h2 id="support" className="text-[15px] font-semibold">{t('impersonateSection')}</h2>
            <p className="text-sm text-muted-foreground">{t('impersonateSectionBody')}</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" size="sm" variant="outline" onClick={() => setImpersonateOpen(true)}>{t('impersonateOpen')}</Button>
              <Link to={`/admin/support-sessions?tenant=${d.id}`} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">{t('sessionsOfTenant')}</Link>
            </div>
          </section>
        ) : null}
      </div>

      {(canEdit || canPlan) && draft ? (
        <form onSubmit={save} noValidate aria-labelledby="profile" className="space-y-3 rounded-lg border border-border bg-card p-4">
          <h2 id="profile" className="text-[15px] font-semibold">{t('profileTitle')}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {canEdit ? (
              <>
                <div className="space-y-1">
                  <Label htmlFor="tenant-name">{t('name')}</Label>
                  <Input id="tenant-name" required maxLength={200} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} {...invalid('name')} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="tenant-legal">{t('legalName')}</Label>
                  <Input id="tenant-legal" maxLength={200} value={draft.legal_name} onChange={(e) => setDraft({ ...draft, legal_name: e.target.value })} {...invalid('legal_name')} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="tenant-province">{t('province')}</Label>
                  <Select id="tenant-province" value={draft.province} onChange={(e) => setDraft({ ...draft, province: e.target.value })} {...invalid('province')}>
                    <option value="">{t('provinceNone')}</option>
                    {ProvinceCA.options.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="tenant-locale">{t('locale')}</Label>
                  <Select id="tenant-locale" value={draft.default_locale} onChange={(e) => setDraft({ ...draft, default_locale: e.target.value as Draft['default_locale'] })}>
                    <option value="fr-CA">fr-CA</option>
                    <option value="en-CA">en-CA</option>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="tenant-po-name">{t('privacyOfficer')}</Label>
                  <Input id="tenant-po-name" maxLength={120} value={draft.privacy_officer_name} onChange={(e) => setDraft({ ...draft, privacy_officer_name: e.target.value })} {...invalid('privacy_officer_name')} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="tenant-po-email">{t('privacyOfficerEmail')}</Label>
                  <Input id="tenant-po-email" type="email" maxLength={254} value={draft.privacy_officer_email} onChange={(e) => setDraft({ ...draft, privacy_officer_email: e.target.value })} {...invalid('privacy_officer_email')} />
                </div>
              </>
            ) : null}
            {canPlan ? (
              <div className="space-y-1">
                <Label htmlFor="tenant-plan">{t('plan')}</Label>
                <Select id="tenant-plan" value={draft.plan_id} onChange={(e) => setDraft({ ...draft, plan_id: e.target.value })} {...invalid('plan_id')}>
                  {(plans.data?.items ?? []).map((p) => (
                    <option key={p.id} value={p.id}>{tOrgs(TIER_KEYS[p.code])}</option>
                  ))}
                </Select>
              </div>
            ) : null}
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="tenant-reason">{t('reason')}</Label>
              <Input id="tenant-reason" maxLength={500} value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} aria-describedby="tenant-reason-hint" />
              <p id="tenant-reason-hint" className="text-xs text-muted-foreground">{t('reasonHint')}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="sm" disabled={update.isPending}>{t('save')}</Button>
            {feedback ? (
              <span role={feedback.kind} className={`text-sm ${feedback.kind === 'alert' ? 'text-danger-text' : 'text-success-text'}`}>{feedback.text}</span>
            ) : null}
            {fieldError ? (
              <span id="tenant-field-error" className="text-sm text-danger-text">
                {t('invalidField', { field: fieldError in FIELD_LABEL ? t(FIELD_LABEL[fieldError as keyof typeof FIELD_LABEL]) : fieldError })}
              </span>
            ) : null}
          </div>
        </form>
      ) : null}

      <section aria-labelledby="journal" className="space-y-2 rounded-lg border border-border bg-card p-4">
        <h2 id="journal" className="text-[15px] font-semibold">{t('journalTitle')}</h2>
        {events.isPending ? <p aria-busy="true" className="text-sm text-muted-foreground">{t('loading')}</p> : null}
        {events.isError ? <p role="alert" className="text-sm text-danger-text">{t('loadError')}</p> : null}
        {events.isSuccess && events.data.items.length === 0 ? <p className="text-sm text-muted-foreground">{t('journalEmpty')}</p> : null}
        {events.isSuccess && events.data.items.length > 0 ? (
          <ol className="divide-y divide-border text-sm">
            {events.data.items.map((ev) => (
              <li key={ev.id} className="space-y-0.5 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">{fmt(ev.created_at)}</span>
                  <span className="font-medium">
                    {ev.actor_type === 'platform'
                      // The session's OWN rows already name the staffer as the
                      // actor — "X acting as X" was a lie (review).
                      ? ev.impersonator_email && ev.entity_type !== 'impersonation_session'
                        ? t('viaSupport', { staff: ev.impersonator_email, user: ev.actor_email ?? '' })
                        : (ev.actor_email ?? tActivity('platform'))
                      : ev.actor_type === 'system'
                        ? tActivity('system')
                        : (ev.actor_email ?? tActivity('unlistedMember'))}
                  </span>
                  {ev.restricted ? <span className="rounded-full bg-danger-bg px-2 py-0.5 text-xs text-danger-text">{t('restricted')}</span> : null}
                </div>
                {/* The verb and its object first (review): a revoked seat is a fact even with nothing else to spell out. */}
                <p>
                  <span className="font-medium">{tActivity(ACTION_KEYS[ev.action])}</span>
                  {' — '}
                  {t(ENTITY_KEYS[ev.entity_type])}
                </p>
                {renderChange(ev, d)}
                {ev.reason ? <p className="text-xs text-muted-foreground">{ev.reason}</p> : null}
              </li>
            ))}
          </ol>
        ) : null}
      </section>

      <StatusTransitionDialog
        tenant={d}
        to={transition}
        onClose={(changed) => {
          setTransition(null);
          if (changed) {
            const revoked = changed.sessionsRevoked > 0 ? ` ${t('sessionsRevoked', { count: changed.sessionsRevoked })}` : '';
            setLastChange(`${t('statusChanged', { status: tOrgs(STATUS_KEYS[changed.status]) })}${revoked}`);
            void events.refetch();
            // The button that opened the dialog may not survive the refetch
            // (the allowed transitions change with the status): park focus on
            // the announcement instead of letting it fall to <body>.
            requestAnimationFrame(() => lastChangeRef.current?.focus());
          }
        }}
      />

      <StartImpersonationDialog tenant={d} open={impersonateOpen} onClose={() => setImpersonateOpen(false)} />

      <ReissueOwnerDialog
        tenant={d}
        open={reissueOpen}
        onClose={(result) => {
          setReissueOpen(false);
          if (!result) return;
          if (result === 'owner_exists') {
            // The seat was taken while the dialog was open: the facts and the
            // button must catch up before the person acts again (review, F-69).
            setLastChange(t('ownerAlreadyActive'));
            void tenant.refetch();
          } else {
            setLastChange(t('ownerInviteResent', { email: result.email }));
            setAcceptUrl(result.accept_url ?? null);
            void events.refetch();
          }
          requestAnimationFrame(() => lastChangeRef.current?.focus());
        }}
      />

      <Dialog.Root open={planConfirm !== null} onOpenChange={(open: boolean) => { if (!open) setPlanConfirm(null); }}>
        <DialogContent>
          <DialogTitle>{t('planChangeTitle')}</DialogTitle>
          <DialogDescription>{t('planChangeConfirm')}</DialogDescription>
          <div className="flex justify-end gap-2 pt-3">
            <Button type="button" variant="outline" size="sm" onClick={() => setPlanConfirm(null)}>{t('cancel')}</Button>
            <Button
              type="button"
              size="sm"
              disabled={update.isPending}
              onClick={() => {
                const body = planConfirm;
                setPlanConfirm(null);
                if (body) void send(body);
              }}
            >
              {t('confirm')}
            </Button>
          </div>
        </DialogContent>
      </Dialog.Root>
    </div>
  );
}
