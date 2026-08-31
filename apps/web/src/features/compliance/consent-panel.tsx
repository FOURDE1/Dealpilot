import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@dealpilot/ui';
import type { LeadT } from '@dealpilot/schemas';
import { ApiError } from '../../shared/api/client.js';
import { can, usePermissionsMine } from '../../shared/permissions.js';
import { useComplianceCheck, useLeadConsent, useRecordConsent, useRevokeConsent, useSuppress } from './api.js';

/**
 * F-15: may we contact this person, and on what basis?
 *
 * The verdict comes from the server running the SAME function the send layer
 * runs. Nothing here re-derives a rule — if this panel ever disagrees with what
 * actually happens when someone presses send, the panel is the thing teaching
 * staff to distrust the rules.
 *
 * The design choice worth naming: a refusal is shown with its REMEDY, in
 * ordinary words. "No consent" tells a salesperson nothing they can act on;
 * "capture consent before contacting them" tells them what to do next, and that
 * difference decides whether the rule gets followed or worked around.
 */
type TFn = ReturnType<typeof useTranslation<'compliance'>>['t'];

/**
 * Literal keys, not `t(\`status_${x}\`)`.
 *
 * The i18n keys are statically typed in this codebase, and a template literal
 * defeats that: it compiles, and a missing translation then shows up as a raw
 * key on a compliance screen. These maps are exhaustive by construction, so
 * adding a status without a translation fails the build.
 */
const STATUS_LABEL = {
  allowed: (t: TFn) => t('status_allowed'),
  deferred: (t: TFn) => t('status_deferred'),
  blocked: (t: TFn) => t('status_blocked'),
} as const;

const TYPE_LABEL = {
  express: (t: TFn) => t('type_express'),
  implied_inquiry: (t: TFn) => t('type_implied_inquiry'),
  implied_ebr: (t: TFn) => t('type_implied_ebr'),
} as const;

const SCOPE_LABEL = {
  conversational: (t: TFn) => t('scope_conversational'),
  marketing: (t: TFn) => t('scope_marketing'),
  ai_outbound_call: (t: TFn) => t('scope_ai_outbound_call'),
} as const;

const CHANNEL_LABEL = {
  sms: (t: TFn) => t('ch_sms'),
  mms: (t: TFn) => t('ch_mms'),
  email: (t: TFn) => t('ch_email'),
  voice: (t: TFn) => t('ch_voice'),
  all: (t: TFn) => t('ch_all'),
} as const;

export function ConsentPanel({ lead }: { lead: LeadT }) {
  const { t, i18n } = useTranslation('compliance');
  const consents = useLeadConsent(lead.id);
  const sms = useComplianceCheck(lead.id, { channel: 'sms' });
  const voice = useComplianceCheck(lead.id, { channel: 'voice', scope: 'ai_outbound_call' });
  const mine = usePermissionsMine(lead.organization_id);
  const canManage = can(mine.data, 'lead:update');
  const record = useRecordConsent();
  const revoke = useRevokeConsent();
  const suppress = useSuppress();
  const [error, setError] = useState<string | null>(null);
  const busy = record.isPending || revoke.isPending || suppress.isPending;

  // Empty string rather than null: these feed interpolations, and a null there
  // renders the literal "null" to somebody reading a compliance screen.
  const when = (iso: string | null) =>
    iso === null ? '' : new Date(iso).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });
  const day = (iso: string | null) =>
    iso === null ? '' : new Date(iso).toLocaleDateString(i18n.language, { dateStyle: 'medium' });

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('error_unknown'));
    }
  };

  const live = (consents.data ?? []).filter(
    (c) => c.revoked_at === null && (c.expires_at === null || new Date(c.expires_at) > new Date()),
  );

  return (
    <section aria-labelledby="consent-heading" className="rounded-lg border border-border p-4">
      <h2 id="consent-heading" className="text-base font-semibold">
        {t('heading')}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('intro')}</p>

      {/* The verdicts, first, because they are what somebody came to find out. */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {([
          { key: 'sms', label: t('channel_sms'), q: sms },
          { key: 'voice', label: t('channel_voice'), q: voice },
        ] as const).map(({ key, label, q }) => {
          const c = q.data;
          // On-surface tokens proven against the card (F-75, D-076): the
          // tenant `--success` FILL is proven against its own label only, so
          // it is never read as a border — a pale brand made this stripe
          // vanish. `success-text` / `warning-text` are platform-owned and
          // ≥ 4.5:1 on every surface; `danger-border` is the proven border.
          const tone =
            c?.status === 'allowed'
              ? 'border-l-4 border-l-success-text'
              : c?.status === 'deferred'
                ? 'border-l-4 border-l-warning-text'
                : 'border-l-4 border-l-danger-border';
          return (
            <div key={key} className={`rounded-md border border-border p-3 ${c ? tone : ''}`}>
              <h3 className="text-sm font-medium">{label}</h3>
              {q.isPending ? (
                <p className="mt-1 text-sm text-muted-foreground">{t('checking')}</p>
              ) : c ? (
                <>
                  {/* Status in words, never colour alone — colour is not
                      readable to everyone and is invisible in a printout. */}
                  <p className="mt-1 text-sm font-medium">{STATUS_LABEL[c.status](t)}</p>
                  {c.status === 'deferred' && c.deferred_until ? (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t('deferred_until', { when: when(c.deferred_until) })}
                    </p>
                  ) : null}
                  {c.remedy ? <p className="mt-1 text-sm text-muted-foreground">{c.remedy}</p> : null}
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t('their_local_time', {
                      time: when(c.recipient_local_time),
                      zone: c.timezone,
                    })}
                  </p>
                </>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* What we actually hold. */}
      <h3 className="mt-5 text-sm font-medium">{t('bases_heading')}</h3>
      {consents.isPending ? (
        <p className="mt-1 text-sm text-muted-foreground">{t('loading')}</p>
      ) : (consents.data ?? []).length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">{t('bases_none')}</p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {(consents.data ?? []).map((c) => {
            const expired = c.expires_at !== null && new Date(c.expires_at) <= new Date();
            const state = c.revoked_at !== null ? 'revoked' : expired ? 'expired' : 'live';
            return (
              <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span className="text-sm">
                  {TYPE_LABEL[c.consent_type](t)} · {SCOPE_LABEL[c.scope](t)} · {CHANNEL_LABEL[c.channel](t)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {state === 'revoked'
                    ? t('state_revoked', { when: day(c.revoked_at) })
                    : state === 'expired'
                      ? t('state_expired', { when: day(c.expires_at) })
                      : c.expires_at
                        ? t('state_until', { when: day(c.expires_at) })
                        : t('state_indefinite')}
                </span>
                {canManage && state === 'live' ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void run(() => revoke.mutateAsync({ id: c.id, reason: 'staff_manual' }))}
                  >
                    {t('withdraw')}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {canManage ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={busy || live.length > 0}
            onClick={() =>
              void run(() =>
                record.mutateAsync({
                  organization_id: lead.organization_id,
                  store_id: lead.store_id,
                  lead_id: lead.id,
                  phone_e164: lead.phone,
                  channels: ['sms'],
                  scopes: ['conversational'],
                  consent_type: 'express',
                  source: 'staff_manual',
                  // Evidence is required by the server, and rightly: a consent
                  // with nothing behind it is an assertion somebody will one day
                  // be asked to substantiate.
                  evidence: {
                    captured_by: 'staff',
                    wording: t('evidence_verbal'),
                    captured_at: new Date().toISOString(),
                  },
                }),
              )
            }
          >
            {t('record_verbal')}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(() =>
                suppress.mutateAsync({
                  organization_id: lead.organization_id,
                  phone_e164: lead.phone,
                  channel: 'sms',
                }),
              )
            }
          >
            {t('mark_stop')}
          </Button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger-text">
          {error}
        </p>
      ) : null}
    </section>
  );
}
