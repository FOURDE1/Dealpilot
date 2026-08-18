import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../../shared/use-page-title.js';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Label,
  Select,
} from '@dealpilot/ui';
import type { AppointmentKindT, AppointmentT } from '@dealpilot/schemas';
import { ApiError } from '../../shared/api/client.js';
import { useOrganizations, useStores } from '../organizations/api.js';
import { useMembers } from '../team/api.js';
import { useAppointments, useCancelAppointment, useCreateAppointment, useUpdateAppointment } from './api.js';

/**
 * F-38 — the appointments board (conversation-engine.md §4).
 *
 * The assistant books; this is where a person SEES. Grouped by day because the
 * question every morning is "who is coming today", not "what exists". Rows the
 * assistant booked look identical to rows a person booked — the customer does
 * not care who typed, and neither should the board.
 */

const KIND_KEYS = {
  test_drive: 'kindTestDrive',
  showroom_visit: 'kindShowroom',
  phone_call: 'kindPhoneCall',
} as const satisfies Record<AppointmentKindT, string>;

const DURATIONS_MIN = [30, 45, 60] as const;

interface Draft {
  store_id: string;
  kind: AppointmentKindT;
  date: string;
  time: string;
  duration: string;
  stock: string;
  notes: string;
}

const INITIAL: Draft = {
  store_id: '', kind: 'test_drive', date: '', time: '', duration: '45', stock: '', notes: '',
};

export function AppointmentsPage() {
  const { t, i18n } = useTranslation('appointments');
  const { t: tCommon } = useTranslation('common');
  usePageTitle(t('title'));
  const orgs = useOrganizations();
  const multiOrg = (orgs.data?.items.length ?? 0) > 1;
  const [orgFilter, setOrgFilter] = useState('');
  const orgId = multiOrg ? orgFilter || orgs.data?.items[0]?.id : orgs.data?.items[0]?.id;
  const stores = useStores(orgId ?? '');
  const members = useMembers(orgId, { enabled: orgId !== undefined });

  const [showPast, setShowPast] = useState(false);
  const board = useAppointments(orgId, { enabled: orgId !== undefined, upcoming: !showPast });
  const createAppointment = useCreateAppointment();
  const updateAppointment = useUpdateAppointment();

  const [draft, setDraft] = useState<Draft>(INITIAL);
  const [formError, setFormError] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<AppointmentT | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  const storeId = draft.store_id || stores.data?.items[0]?.id;

  async function onBook(event: FormEvent) {
    event.preventDefault();
    if (!orgId || !storeId) return;
    setFormError(null);
    const starts = new Date(`${draft.date}T${draft.time}`);
    if (Number.isNaN(starts.getTime())) {
      setFormError(t('whenInvalid'));
      return;
    }
    const ends = new Date(starts.getTime() + Number(draft.duration) * 60_000);
    try {
      await createAppointment.mutateAsync({
        organization_id: orgId,
        store_id: storeId,
        kind: draft.kind,
        starts_at: starts.toISOString(),
        ends_at: ends.toISOString(),
        ...(draft.stock.trim() === '' ? {} : { vehicle_stock_number: draft.stock.trim() }),
        ...(draft.notes.trim() === '' ? {} : { notes: draft.notes.trim() }),
      });
      setDraft(INITIAL);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t('genericError'));
    }
  }

  async function onAssign(a: AppointmentT, agentId: string) {
    setRowError(null);
    try {
      await updateAppointment.mutateAsync({ id: a.id, assigned_agent_id: agentId === '' ? null : agentId });
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : t('genericError'));
    }
  }

  async function onConfirm(a: AppointmentT) {
    setRowError(null);
    try {
      await updateAppointment.mutateAsync({ id: a.id, status: 'confirmed' });
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : t('genericError'));
    }
  }

  /** Rows grouped by local day, in board order. */
  const days = useMemo(() => {
    const byDay = new Map<string, AppointmentT[]>();
    for (const a of board.data?.items ?? []) {
      const day = new Date(a.starts_at).toLocaleDateString(i18n.language, {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      });
      byDay.set(day, [...(byDay.get(day) ?? []), a]);
    }
    return [...byDay.entries()];
  }, [board.data, i18n.language]);

  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        {multiOrg ? (
          <div className="mt-3 max-w-xs space-y-1">
            <Label htmlFor="appt-org">{t('orgScope')}</Label>
            <Select id="appt-org" value={orgId ?? ''} onChange={(e) => setOrgFilter(e.target.value)}>
              {orgs.data?.items.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </Select>
          </div>
        ) : null}
      </header>

      <form onSubmit={(e) => void onBook(e)} className="grid max-w-4xl gap-3 rounded-lg border border-border p-4 sm:grid-cols-2 lg:grid-cols-4" aria-label={t('bookTitle')}>
        <div className="space-y-1">
          <Label htmlFor="appt-store">{t('store')}</Label>
          <Select id="appt-store" value={draft.store_id || (stores.data?.items[0]?.id ?? '')} onChange={(e) => set('store_id', e.target.value)}>
            {stores.data?.items.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="appt-kind">{t('kind')}</Label>
          <Select id="appt-kind" value={draft.kind} onChange={(e) => set('kind', e.target.value as AppointmentKindT)}>
            {(Object.keys(KIND_KEYS) as AppointmentKindT[]).map((k) => (
              <option key={k} value={k}>{t(KIND_KEYS[k])}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="appt-date">{t('date')}</Label>
          <Input id="appt-date" type="date" value={draft.date} onChange={(e) => set('date', e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="appt-time">{t('time')}</Label>
          <Input id="appt-time" type="time" value={draft.time} onChange={(e) => set('time', e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="appt-duration">{t('duration')}</Label>
          <Select id="appt-duration" value={draft.duration} onChange={(e) => set('duration', e.target.value)}>
            {DURATIONS_MIN.map((m) => (
              <option key={m} value={String(m)}>{t('durationMin', { minutes: m })}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="appt-stock" optionalText={tCommon('optional')}>{t('stock')}</Label>
          <Input id="appt-stock" className="font-mono" value={draft.stock} onChange={(e) => set('stock', e.target.value)} />
        </div>
        <div className="space-y-1 sm:col-span-2 lg:col-span-1">
          <Label htmlFor="appt-notes" optionalText={tCommon('optional')}>{t('notes')}</Label>
          <Input id="appt-notes" value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
        <div className="flex items-end">
          <Button
            type="submit"
            disabled={
              createAppointment.isPending ||
              draft.date === '' ||
              draft.time === '' ||
              // Same rule the inventory Add button learned: a button that
              // cannot succeed (no store resolved yet) must not be clickable.
              storeId === undefined
            }
          >
            {t('bookButton')}
          </Button>
        </div>
        {formError ? (
          <p role="alert" className="text-sm text-danger-text sm:col-span-2 lg:col-span-4">{formError}</p>
        ) : null}
      </form>

      <div className="flex items-center gap-2">
        <input
          id="appt-past"
          type="checkbox"
          className="size-4 accent-primary"
          checked={showPast}
          onChange={(e) => setShowPast(e.target.checked)}
        />
        <Label htmlFor="appt-past">{t('showHistory')}</Label>
      </div>

      {rowError ? <p role="alert" className="text-sm text-danger-text">{rowError}</p> : null}
      {board.data?.truncated ? (
        <p role="status" className="text-sm text-warning-text">{t('truncated')}</p>
      ) : null}

      {board.isPending ? (
        <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
      ) : board.isError ? (
        <p role="alert" className="text-sm text-danger-text">{t('genericError')}</p>
      ) : days.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          {showPast ? t('emptyHistory') : t('empty')}
        </div>
      ) : (
        days.map(([day, items]) => (
          <section key={day} aria-label={day} className="space-y-2">
            <h2 className="text-sm font-semibold capitalize">{day}</h2>
            <ul className="space-y-2">
              {items.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3 text-sm">
                  <span className="font-mono tabular-nums">{time(a.starts_at)}–{time(a.ends_at)}</span>
                  <span className="font-medium">{t(KIND_KEYS[a.kind])}</span>
                  {a.vehicle_stock_number ? (
                    <span className="font-mono text-xs text-muted-foreground">№ {a.vehicle_stock_number}</span>
                  ) : null}
                  {a.status === 'confirmed' ? (
                    <span className="rounded-full bg-success-bg px-2 py-0.5 text-xs font-medium text-success-text">
                      {t('statusConfirmed')}
                    </span>
                  ) : null}
                  {a.status === 'cancelled' ? (
                    <span className="rounded-full bg-danger-bg px-2 py-0.5 text-xs font-medium text-danger-text">
                      {t('statusCancelled')}
                    </span>
                  ) : null}
                  {a.notes ? <span className="text-muted-foreground">{a.notes}</span> : null}
                  {a.cancelled_reason ? (
                    <span className="text-xs text-muted-foreground">{t('cancelledBecause', { reason: a.cancelled_reason })}</span>
                  ) : null}
                  <span className="ms-auto flex items-center gap-2">
                    {a.status === 'booked' || a.status === 'confirmed' ? (
                      <>
                        <Label htmlFor={`agent-${a.id}`} className="sr-only">{t('agent')}</Label>
                        <Select
                          id={`agent-${a.id}`}
                          aria-label={`${t('agent')} — ${time(a.starts_at)}`}
                          value={a.assigned_agent_id ?? ''}
                          onChange={(e) => void onAssign(a, e.target.value)}
                          className="min-w-40"
                        >
                          <option value="">{t('unassigned')}</option>
                          {members.data?.items
                            .filter((m) => m.status === 'active')
                            .map((m) => (
                              <option key={m.user_id} value={m.user_id}>{m.name}</option>
                            ))}
                        </Select>
                        {a.status === 'booked' ? (
                          <Button type="button" variant="outline" onClick={() => void onConfirm(a)}>
                            {t('confirm')}
                          </Button>
                        ) : null}
                        <Button type="button" variant="outline" onClick={() => setCancelTarget(a)}>
                          {t('cancelOpen')}
                        </Button>
                      </>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <CancelDialog target={cancelTarget} onClose={() => setCancelTarget(null)} timeOf={time} />
    </div>
  );
}

/** The reason is the point: the board must be able to say why a slot emptied. */
function CancelDialog({
  target, onClose, timeOf,
}: {
  target: AppointmentT | null;
  onClose: () => void;
  timeOf: (iso: string) => string;
}) {
  const { t } = useTranslation('appointments');
  const cancelAppointment = useCancelAppointment();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onCancel(event: FormEvent) {
    event.preventDefault();
    if (!target) return;
    setError(null);
    try {
      await cancelAppointment.mutateAsync({ id: target.id, reason: reason.trim() });
      setReason('');
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('genericError'));
    }
  }

  return (
    <Dialog.Root
      open={target !== null}
      onOpenChange={(o) => {
        if (!o) {
          setReason('');
          setError(null);
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogTitle>{t('cancelTitle')}</DialogTitle>
        <DialogDescription>
          {target ? t('cancelBody', { time: timeOf(target.starts_at) }) : ''}
        </DialogDescription>
        <form onSubmit={(e) => void onCancel(e)} className="mt-3 space-y-3">
          <div className="space-y-1">
            <Label htmlFor="cancel-reason">{t('cancelReason')}</Label>
            <Input id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            <p className="text-xs text-muted-foreground">{t('cancelReasonHint')}</p>
          </div>
          {error ? <p role="alert" className="text-sm text-danger-text">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Dialog.Close render={<Button type="button" variant="outline">{t('keep')}</Button>} />
            <Button type="submit" variant="destructive" disabled={reason.trim().length < 3 || cancelAppointment.isPending}>
              {t('cancelConfirm')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog.Root>
  );
}
