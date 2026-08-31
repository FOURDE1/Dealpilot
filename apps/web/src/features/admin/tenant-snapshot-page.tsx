import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { DataTable, type ColumnDef } from '@dealpilot/ui';
import type { SnapshotIntakeKeyT, SnapshotStoreHealthT } from '@dealpilot/schemas';
import { BackLink } from '../../shared/ui/back-link.js';
import { usePageTitle } from '../../shared/use-page-title.js';
import { useAdminTenantSnapshot } from './api.js';
import {
  BRANDING_STATE_KEYS, PROVIDER_KEYS, STATUS_CLASSES, STATUS_KEYS, STORE_STATUS_KEYS, TIER_KEYS, USAGE_METRIC_KEYS,
} from './labels.js';

/**
 * F-77 — one tenant's snapshot (admin-console.md §9): the operating facts a
 * support call needs on one screen, from the `admin_tenant_snapshot` definer
 * through `useAdminTenantSnapshot`, which PARSES the body — a zod object
 * strips every key it does not name, so nothing the schema leaves out can
 * reach this file.
 *
 * Three rules shape the page.
 *
 * The header identity comes from the snapshot's own body, never from a second
 * hook: `AdminTenantSnapshot` extends `AdminTenantDetail` precisely so this
 * screen and the tenant page cannot disagree about the tenant (D-074 (7)),
 * and one fetch is one producer of the name.
 *
 * Every value is read by its name through `d.<key>` or `row.original.<key>`
 * — no generic walk over a row, no computed key on a data binding, no spread
 * into JSX — so the only fields that can appear are the ones written here,
 * and the guard tests read this file to hold it to that.
 *
 * No UUID is rendered anywhere on the page — ids are React keys and join keys
 * only. The store column of the intake-key table prints the store's NAME
 * (a join over the same body); the tenant's id lives in an href, not a text
 * node. That rule is also what keeps the browser journey's 32-hex scan free of
 * false positives.
 */

/**
 * Own-property lookup over a label table: a wire string is a key only if the
 * table names it. Not `in`, which also admits Object.prototype names —
 * `'constructor' in table` is true, and i18next handed that value renders blank.
 */
const labelled = <M extends Record<string, string>>(table: M, value: string): value is Extract<keyof M, string> =>
  Object.hasOwn(table, value);

export function TenantSnapshotPage() {
  const { t, i18n } = useTranslation('snapshot');
  const { t: tAdmin } = useTranslation('admin');
  const { t: tOrgs } = useTranslation('orgs');
  const { t: tSettings } = useTranslation('settings');
  const { t: tIntake } = useTranslation('intake');
  const { t: tUsage } = useTranslation('usage');
  const { tenantId = '' } = useParams();
  const snapshot = useAdminTenantSnapshot(tenantId);
  usePageTitle(t('title'));

  const number = (n: number) => new Intl.NumberFormat(i18n.language).format(n);
  const moment = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  /** The definer returns `time` text (HH:MM:SS); the automations page shows HH:MM. */
  const clock = (value: string | null) => (value === null ? '—' : value.slice(0, 5));

  const storeStatus = (status: string) => (labelled(STORE_STATUS_KEYS, status) ? tAdmin(STORE_STATUS_KEYS[status]) : status);
  const provider = (value: string) => (labelled(PROVIDER_KEYS, value) ? tIntake(PROVIDER_KEYS[value]) : value);
  /**
   * revoked_at decides first (0069:477-479): the two columns are independent
   * and a revoked key with active = true must not read as live. The third
   * word is the type-completeness fallback for a schema-permitted corner —
   * `active = false ∧ revoked_at = null` has no producer today (the revoke
   * UPDATE sets both in one statement, f03-intake-routes.ts:158-159) — and
   * exists so a schema-legal row never renders blank or as a raw boolean.
   */
  const keyState = (active: boolean, revokedAt: string | null) => {
    if (revokedAt !== null) return t('keyRevoked', { date: moment(revokedAt) });
    return active ? t('keyActive') : t('keyInactive');
  };

  // The h1 and the back link render at once; the identity chips wait for the
  // body they come from.
  const frame = (identity: ReactNode, children: ReactNode) => (
    <div className="space-y-6">
      <BackLink to="/admin/tenants">{tAdmin('back')}</BackLink>
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        {identity}
      </header>
      {children}
    </div>
  );

  if (snapshot.isPending) {
    return frame(null, <p aria-busy="true" className="text-sm text-muted-foreground">{tAdmin('loading')}</p>);
  }
  if (!snapshot.isSuccess) {
    return frame(null, <p role="alert" className="text-sm text-danger-text">{tAdmin('loadError')}</p>);
  }

  const d = snapshot.data;
  const byId = new Map(d.store_health.map((s) => [s.id, s.name]));
  /**
   * Two states of `store_id` look alike on the wire and must not on the page.
   * `null` is a LIVE organization-level key: the column is NULLABLE (0050:61,
   * « an org-level key is the dealer group's ad-platform front door ») and
   * intake_resolve serves such a key without a store (0065:684) — the cell
   * prints the settings pages' own organization-scope word. A `store_id` that
   * names no rooftop is a key whose store was soft-deleted — store_health
   * keeps only `s.deleted_at IS NULL` rows (0069:472) while the keys are
   * projected without that filter (0069:489) — and « — » says exactly that.
   */
  const storeName = (storeId: string | null) => (storeId === null ? tSettings('orgScope') : (byId.get(storeId) ?? null));

  const storeColumns: ColumnDef<SnapshotStoreHealthT, unknown>[] = [
    {
      id: 'store',
      accessorKey: 'name',
      header: tSettings('col_store'),
      cell: ({ row }) => (
        <>
          <span className="font-medium">{row.original.name}</span>
          <span className="block font-mono text-xs text-muted-foreground">{row.original.code}</span>
        </>
      ),
    },
    { id: 'status', accessorKey: 'status', header: tAdmin('colStatus'), cell: ({ row }) => storeStatus(row.original.status) },
    {
      id: 'timezone',
      accessorKey: 'timezone',
      header: tSettings('col_timezone'),
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.timezone}</span>,
    },
    {
      id: 'sms',
      accessorFn: (s) => s.sms_number ?? '',
      header: tSettings('col_sms'),
      // The plain literal, as Réglages → Succursales prints it: no number is
      // recorded for this store.
      cell: ({ row }) => (row.original.sms_number === null ? '—' : <span className="tabular-nums">{row.original.sms_number}</span>),
    },
    {
      id: 'hours',
      accessorFn: (s) => (s.business_hours_set ? 1 : 0),
      header: tSettings('col_hours'),
      cell: ({ row }) => tSettings(row.original.business_hours_set ? 'hoursSet' : 'hoursUnset'),
    },
    {
      id: 'traffic',
      accessorFn: (s) => s.traffic_30d.inbound + s.traffic_30d.outbound,
      header: t('colTraffic'),
      // One cell for the three counts keeps the window in the header, where
      // the definer's own comment wants it (0069:404-408); zeros are words.
      cell: ({ row }) => (
        <span className="tabular-nums">
          {t('trafficCell', {
            inbound: row.original.traffic_30d.inbound,
            outbound: row.original.traffic_30d.outbound,
            delivered: row.original.traffic_30d.delivered,
          })}
        </span>
      ),
    },
    {
      id: 'lastMessage',
      accessorFn: (s) => s.traffic_30d.last_message_at ?? '',
      header: t('colLastMessage'),
      cell: ({ row }) =>
        row.original.traffic_30d.last_message_at === null ? t('noMessage30d') : moment(row.original.traffic_30d.last_message_at),
    },
  ];

  const keyColumns: ColumnDef<SnapshotIntakeKeyT, unknown>[] = [
    { id: 'label', accessorKey: 'label', header: tIntake('label'), cell: ({ row }) => row.original.label },
    { id: 'provider', accessorKey: 'provider', header: tIntake('provider'), cell: ({ row }) => provider(row.original.provider) },
    {
      id: 'store',
      accessorFn: (k) => storeName(k.store_id) ?? '',
      header: tSettings('col_store'),
      cell: ({ row }) => storeName(row.original.store_id) ?? '—',
    },
    {
      id: 'state',
      accessorFn: (k) => (k.revoked_at !== null ? 2 : k.active ? 0 : 1),
      header: tAdmin('colStatus'),
      cell: ({ row }) => keyState(row.original.active, row.original.revoked_at),
    },
    {
      id: 'lastAccepted',
      accessorFn: (k) => k.last_lead_accepted_at ?? '',
      header: t('colLastAccepted'),
      cell: ({ row }) =>
        row.original.last_lead_accepted_at === null ? tAdmin('never') : moment(row.original.last_lead_accepted_at),
    },
  ];

  const identity = (
    <>
      <Link to={`/admin/tenants/${d.id}`} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">
        {d.name}
      </Link>
      <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_CLASSES[d.status]}`}>{tOrgs(STATUS_KEYS[d.status])}</span>
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{tOrgs(TIER_KEYS[d.plan_code])}</span>
      {d.deleted_at ? (
        <span className="rounded-full bg-danger-bg px-2 py-0.5 text-xs text-danger-text">{tAdmin('deletedTenant')}</span>
      ) : null}
    </>
  );

  return frame(
    identity,
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* The two table sections carry no card chrome of their own: DataTable
          paints the bordered card itself (data-table.tsx:81, :85), as on every other
          table page in the console and the tenant app. The section stays —
          its accessible name is what makes it a region. */}
      <section aria-labelledby="snap-stores" className="space-y-3 lg:col-span-2">
        <h2 id="snap-stores" className="text-[15px] font-semibold">{tAdmin('storesTitle')}</h2>
        <DataTable
          columns={storeColumns}
          data={d.store_health}
          loadingMessage={tAdmin('loading')}
          errorMessage={tAdmin('loadError')}
          emptyMessage={t('storesEmpty')}
        />
        {/* The assistant-behaviour fact has one string — the store form's own
            hint under its hours grid — and one more sentence says where the
            hours are set, which the tenant page never has to say. */}
        <p className="text-sm text-muted-foreground">{tOrgs('hoursHint')}</p>
        <p className="text-sm text-muted-foreground">{t('hoursWhere')}</p>
      </section>

      <section aria-labelledby="snap-keys" className="space-y-3 lg:col-span-2">
        <h2 id="snap-keys" className="text-[15px] font-semibold">{tIntake('title')}</h2>
        <DataTable
          columns={keyColumns}
          data={d.intake_keys}
          loadingMessage={tAdmin('loading')}
          errorMessage={tAdmin('loadError')}
          emptyMessage={t('keysEmpty')}
        />
        <p className="text-sm text-muted-foreground">{t('keysCaption')}</p>
      </section>

      <section aria-labelledby="snap-comms" className="space-y-3 rounded-lg border border-border bg-card p-4 lg:col-span-2">
        <h2 id="snap-comms" className="text-[15px] font-semibold">{tSettings('sec_automations')}</h2>
        {d.comms_config.org_row_present ? (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
            <dt className="text-muted-foreground">{tSettings('windowStart')}</dt>
            <dd className="tabular-nums">{clock(d.comms_config.sms_quiet_start)}</dd>
            <dt className="text-muted-foreground">{tSettings('windowEnd')}</dt>
            <dd className="tabular-nums">{clock(d.comms_config.sms_quiet_end)}</dd>
            <dt className="text-muted-foreground">{tSettings('firstTouchExempt')}</dt>
            <dd>
              {d.comms_config.first_touch_quiet_exempt === null ? '—' : tAdmin(d.comms_config.first_touch_quiet_exempt ? 'yes' : 'no')}
            </dd>
            <dt className="text-muted-foreground">{tSettings('dailyCap')}</dt>
            <dd className="tabular-nums">
              {d.comms_config.ai_daily_contact_cap === null ? '—' : number(d.comms_config.ai_daily_contact_cap)}
            </dd>
          </dl>
        ) : (
          // The one sentence the tenant's own Automatisations page prints when
          // no row exists — the same fact, the same string.
          <p className="text-sm text-muted-foreground">{tSettings('defaultsNotice')}</p>
        )}
        {/* Counted independently of the organization row (0069:427-430), so
            it is stated in both states — it is what would qualify the
            sentence above the day a store-level row exists. */}
        <p className="text-sm">{t('storeOverrides', { count: d.comms_config.store_overrides })}</p>
      </section>

      <section aria-labelledby="snap-branding" className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h2 id="snap-branding" className="text-[15px] font-semibold">{tAdmin('entity_tenant_branding')}</h2>
        {/* 'none' is the definer's COALESCE word; 'draft' means unpublished
            edits, not that nothing is live (0069:440-441). An unknown state
            renders raw rather than blank. */}
        <p className="text-sm font-medium">
          {labelled(BRANDING_STATE_KEYS, d.branding.state) ? t(BRANDING_STATE_KEYS[d.branding.state]) : d.branding.state}
        </p>
        {d.branding.version !== null ? <p className="text-sm tabular-nums">{t('brandVersion', { version: d.branding.version })}</p> : null}
        {d.branding.published_at !== null ? (
          <p className="text-sm">{t('brandPublishedAt', { date: moment(d.branding.published_at) })}</p>
        ) : d.branding.state === 'draft' ? (
          <p className="text-sm">{t('brandNeverPublished')}</p>
        ) : null}
        <p className="text-xs text-muted-foreground">{t('brandCaption')}</p>
      </section>

      <section aria-labelledby="snap-access" className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h2 id="snap-access" className="text-[15px] font-semibold">{t('accessHeading')}</h2>
        {/* The D-074 pairing travels with the number: a usage figure never
            reaches a screen without its caption. */}
        <dl className="space-y-0.5">
          <dt className="text-sm text-muted-foreground">{tUsage(USAGE_METRIC_KEYS.seats_provisioned.label)}</dt>
          <dd className="text-xl font-semibold tabular-nums">{number(d.seats_provisioned)}</dd>
          <dd className="text-xs text-muted-foreground">{tUsage(USAGE_METRIC_KEYS.seats_provisioned.caption)}</dd>
        </dl>
        <p className="text-sm">{t('connectors', { count: d.connectors_active })}</p>
        <p className="text-xs text-muted-foreground">{t('connectorsCaption')}</p>
      </section>

      {/* Last, and dashed: deployment configuration, identical for every
          tenant — separated so it cannot be read as a per-tenant switch. */}
      <section
        aria-labelledby="snap-platform"
        className="space-y-3 rounded-lg border border-dashed border-border bg-card p-4 lg:col-span-2"
      >
        <h2 id="snap-platform" className="text-[15px] font-semibold">{t('platformHeading')}</h2>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-0.5">
            <dt className="text-sm text-muted-foreground">{t('transportSms')}</dt>
            <dd className="font-mono text-xs">{d.platform.sms_transport}</dd>
          </div>
          <div className="space-y-0.5">
            <dt className="text-sm text-muted-foreground">{t('transportEmail')}</dt>
            <dd className="font-mono text-xs">{d.platform.email_transport}</dd>
          </div>
          <div className="space-y-0.5">
            <dt className="text-sm text-muted-foreground">{t('transportAi')}</dt>
            <dd className="font-mono text-xs">{d.platform.ai_transport}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">{t('platformCaption')}</p>
      </section>
    </div>,
  );
}
