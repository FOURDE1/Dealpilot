import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../../shared/use-page-title.js';
import { Button, Input, Label, Select } from '@dealpilot/ui';
import type { MemberT, StaffScheduleT } from '@dealpilot/schemas';
import { ApiError } from '../../shared/api/client.js';
import { useOrganizations, useStores } from '../organizations/api.js';
import { activeMembers, useMembers, useUpdateMember } from '../team/api.js';
import { useCreateSchedule, useDeleteSchedule, useSchedules, useScheduleToday } from './api.js';

/**
 * F-42/F-43 — the working-hours grid and the agent profile (FR-LEAD-015).
 *
 * One surface for "who can take leads, and when": each member's weekly
 * windows (store-anchored — times mean that store's timezone), their spoken
 * languages and lead cap (the cascade's inputs), and today's live verdict —
 * working now, online now. A member with NO windows is always-available;
 * the grid is opt-in (D-045 #8).
 *
 * Writes are schedule:manage / member:update_roles server-side; the screen
 * shows the server's refusal rather than hiding buttons.
 */

const DAY_KEYS = ['day0', 'day1', 'day2', 'day3', 'day4', 'day5', 'day6'] as const;

export function SchedulesPage() {
  const { t } = useTranslation('schedules');
  const { t: tCommon } = useTranslation('common');
  usePageTitle(t('title'));
  const orgs = useOrganizations();
  const multiOrg = (orgs.data?.items.length ?? 0) > 1;
  const [orgFilter, setOrgFilter] = useState('');
  const orgId = multiOrg ? orgFilter || orgs.data?.items[0]?.id : orgs.data?.items[0]?.id;
  const stores = useStores(orgId ?? '');
  const members = useMembers(orgId, { enabled: orgId !== undefined });
  const roster = activeMembers(members.data?.items);

  const schedules = useSchedules(orgId);
  const today = useScheduleToday(orgId);
  const createSchedule = useCreateSchedule();
  const deleteSchedule = useDeleteSchedule();
  const updateMember = useUpdateMember(orgId);

  const [error, setError] = useState<string | null>(null);

  const byUser = useMemo(() => {
    const map = new Map<string, StaffScheduleT[]>();
    for (const row of schedules.data?.items ?? []) {
      const list = map.get(row.user_id) ?? [];
      list.push(row);
      map.set(row.user_id, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time));
    return map;
  }, [schedules.data]);

  const todayOf = (userId: string) => today.data?.items.find((i) => i.user_id === userId);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('genericError'));
    }
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        <p className="mt-1 text-sm">
          <Link to="/team" className="font-medium text-primary underline-offset-4 hover:underline">
            {t('backToTeam')}
          </Link>
        </p>
        {multiOrg ? (
          <div className="mt-3 max-w-xs space-y-1">
            <Label htmlFor="sd-org">{t('orgScope')}</Label>
            <Select id="sd-org" value={orgId ?? ''} onChange={(e) => setOrgFilter(e.target.value)}>
              {orgs.data?.items.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </Select>
          </div>
        ) : null}
      </header>

      {error ? <p role="alert" className="text-sm text-danger-text">{error}</p> : null}

      {members.isPending || schedules.isPending ? (
        <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
      ) : (
        <ul className="max-w-4xl space-y-3">
          {roster.map((member) => (
            <MemberCard
              key={member.id}
              member={member}
              windows={byUser.get(member.user_id) ?? []}
              todayItem={todayOf(member.user_id)}
              orgId={orgId ?? ''}
              storeItems={stores.data?.items ?? []}
              onCreate={(input) => run(() => createSchedule.mutateAsync(input))}
              onDelete={(id) => run(() => deleteSchedule.mutateAsync(id))}
              onProfile={(body) => run(() => updateMember.mutateAsync({ id: member.id, body }))}
              busy={createSchedule.isPending || deleteSchedule.isPending || updateMember.isPending}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function MemberCard(props: {
  member: MemberT;
  windows: StaffScheduleT[];
  todayItem: { working_now: boolean; online: boolean | null } | undefined;
  orgId: string;
  storeItems: Array<{ id: string; name: string }>;
  onCreate: (input: {
    organization_id: string; store_id: string; user_id: string;
    day_of_week: number; start_time: string; end_time: string; active: boolean;
  }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onProfile: (body: { preferred_languages?: Array<'fr-CA' | 'en-CA'>; max_active_leads?: number }) => Promise<void>;
  busy: boolean;
}) {
  const { t } = useTranslation('schedules');
  const { member, windows, todayItem } = props;
  const [day, setDay] = useState('1');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('17:00');
  const [storeId, setStoreId] = useState('');
  const [cap, setCap] = useState(String(member.max_active_leads));
  const fr = member.preferred_languages.includes('fr-CA');
  const en = member.preferred_languages.includes('en-CA');

  const storeName = (id: string) => props.storeItems.find((s) => s.id === id)?.name ?? '…';

  async function addWindow(event: FormEvent) {
    event.preventDefault();
    const store = storeId || props.storeItems[0]?.id;
    if (!store) return;
    await props.onCreate({
      organization_id: props.orgId,
      store_id: store,
      user_id: member.user_id,
      day_of_week: Number(day),
      start_time: start,
      end_time: end,
      active: true,
    });
  }

  async function toggleLanguage(code: 'fr-CA' | 'en-CA') {
    const next = new Set(member.preferred_languages);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    // The engine requires at least one language — mirror that refusal here.
    if (next.size === 0) return;
    await props.onProfile({ preferred_languages: [...next] as Array<'fr-CA' | 'en-CA'> });
  }

  async function saveCap() {
    const n = Number(cap);
    if (!Number.isInteger(n) || n < 1 || n > 1000) return;
    await props.onProfile({ max_active_leads: n });
  }

  return (
    <li className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{member.name}</span>
        <span className="text-sm text-muted-foreground">{member.roles.join(', ')}</span>
        {todayItem ? (
          <span className="ms-auto flex items-center gap-2 text-xs">
            <span className={`rounded-full px-2 py-0.5 ${todayItem.working_now ? 'bg-success-bg text-success-text' : 'bg-secondary text-secondary-foreground'}`}>
              {todayItem.working_now ? t('workingNow') : t('offShift')}
            </span>
            {todayItem.online === null ? null : (
              <span className={`rounded-full px-2 py-0.5 ${todayItem.online ? 'bg-success-bg text-success-text' : 'bg-secondary text-secondary-foreground'}`}>
                {todayItem.online ? t('online') : t('offline')}
              </span>
            )}
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-4 text-sm">
        <fieldset className="space-y-1">
          <legend className="text-xs font-medium text-muted-foreground">{t('languages')}</legend>
          <div className="flex gap-3">
            <label className="flex items-center gap-2 max-lg:min-h-11">
              <input type="checkbox" checked={fr} disabled={props.busy} onChange={() => void toggleLanguage('fr-CA')} className="size-4 accent-primary" />
              {t('lang_fr')}
            </label>
            <label className="flex items-center gap-2 max-lg:min-h-11">
              <input type="checkbox" checked={en} disabled={props.busy} onChange={() => void toggleLanguage('en-CA')} className="size-4 accent-primary" />
              {t('lang_en')}
            </label>
          </div>
        </fieldset>
        <div className="space-y-1">
          <Label htmlFor={`cap-${member.id}`}>{t('maxLeads')}</Label>
          <div className="flex gap-2">
            <Input
              id={`cap-${member.id}`}
              type="number"
              inputMode="numeric"
              min={1}
              max={1000}
              value={cap}
              onChange={(e) => setCap(e.target.value)}
              className="w-24"
            />
            <Button type="button" variant="outline" onClick={() => void saveCap()} disabled={props.busy || Number(cap) === member.max_active_leads}>
              {t('saveCap')}
            </Button>
          </div>
        </div>
      </div>

      {windows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noWindows')}</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {windows.map((w) => (
            <li key={w.id} className={`flex flex-wrap items-center gap-2 ${w.active ? '' : 'opacity-60'}`}>
              <span className="w-24 font-medium">{t(DAY_KEYS[w.day_of_week] ?? 'day0')}</span>
              <span className="font-mono tabular-nums">{w.start_time}–{w.end_time}</span>
              <span className="text-xs text-muted-foreground">{storeName(w.store_id)}</span>
              <Button
                type="button"
                variant="outline"
                className="ms-auto"
                onClick={() => void props.onDelete(w.id)}
                disabled={props.busy}
              >
                {t('removeWindow', { day: t(DAY_KEYS[w.day_of_week] ?? 'day0') })}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={(e) => void addWindow(e)} className="flex flex-wrap items-end gap-2" aria-label={t('addTitle', { name: member.name })}>
        <div className="space-y-1">
          <Label htmlFor={`day-${member.id}`}>{t('day')}</Label>
          <Select id={`day-${member.id}`} value={day} onChange={(e) => setDay(e.target.value)}>
            {DAY_KEYS.map((k, i) => (
              <option key={k} value={i}>{t(k)}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`start-${member.id}`}>{t('start')}</Label>
          <Input id={`start-${member.id}`} type="time" value={start} onChange={(e) => setStart(e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`end-${member.id}`}>{t('end')}</Label>
          <Input id={`end-${member.id}`} type="time" value={end} onChange={(e) => setEnd(e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`store-${member.id}`}>{t('store')}</Label>
          <Select id={`store-${member.id}`} value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            {props.storeItems.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </div>
        <Button type="submit" disabled={props.busy || props.storeItems.length === 0}>
          {t('addButton')}
        </Button>
      </form>
    </li>
  );
}
