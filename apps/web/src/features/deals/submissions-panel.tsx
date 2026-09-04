import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Label, Select } from '@dealpilot/ui';
import {
  SUBMISSION_PLATFORMS,
  SUBMISSION_STATUSES,
  type CreateSubmissionInputT,
  type DealSubmissionT,
  type DealT,
  type LenderT,
  type SubmissionPlatformT,
  type SubmissionStatusT,
  type UpdateSubmissionInputT,
} from '@dealpilot/schemas';
import { ApiError } from '../../shared/api/client.js';
import { can, usePermissionsMine } from '../../shared/permissions.js';
import { useLenders } from '../lenders/api.js';
import { deskingLenderSelect } from '../lenders/options.js';
import { CATEGORY_KEYS } from '../lenders/labels.js';
import { formatBps, formatCents, parseMoneyToCents, parsePctToBps, spreadBps } from './money.js';
import { useCreateSubmission, useSelectSubmission, useSubmissions, useUpdateSubmission } from './submissions-api.js';
import {
  SUBMISSION_PLATFORM_KEYS,
  SUBMISSION_STATUS_KEYS,
  bpsToRateInput,
  ceilingExceeded,
  deskDiffers,
  selectability,
  type LiveTerms,
} from './submissions-model.js';

/**
 * F-81 — « Soumissions aux prêteurs »: the fifth section of the desking
 * worksheet's left column (lenders-billofsale.md §2.1–§2.3, D-082).
 *
 * A ledger of what each lender ANSWERED, hand-typed. Nothing here feeds desk
 * math: the lender's quoted payment renders only inside its captioned
 * sentence, the rate spread is derived at render (never stored), and the
 * ceiling WARNS on the chosen row without ever refusing. The one door onto
 * the deal is « Choisir cette approbation », whose response deal the page
 * applies to its draft (the stale-form fix) through `onPromoted`.
 *
 * Permission posture: writes reuse `deal:update` (the fi-products precedent);
 * `usePermissionsMine` is owned here because the desking page queries no
 * permissions. Zero-request law: without the permission no write control
 * exists — the reader sees the list plus one sentence, and every mutation
 * hook stays idle. The read-only sentence renders only once the permission
 * answer is in (`mine.isSuccess && !canWrite`), so a writer never sees it.
 *
 * ONE form at a time (`mode`): opening « Modifier — {lender} » replaces the
 * add form, so no label ever appears twice on the page (Playwright strict
 * mode, and a person's eyes). The container owns the mode; the view is
 * exported so the static test harness can open the editor.
 */

export type PanelMode = 'closed' | 'add' | { readonly edit: string };

export interface SubmissionsPanelProps {
  dealId: string;
  orgId: string;
  /** The live worksheet (rate/term/lender) — the desk-differs chip's basis (A7). */
  live: LiveTerms;
  /** The engine's amount financed (live calc, else the saved deal) — the ceiling chip's basis (A8). */
  amountFinancedCents: number | null;
  dealType: 'finance' | 'lease' | 'cash';
  /** Called with the server's re-desked deal after a successful select. */
  onPromoted: (deal: DealT) => void;
}

type ErrorKey =
  | 'submSelectErr_lender_inactive'
  | 'submErr_invalid_reference'
  | 'submLockedHint'
  | 'submSelectErr_conditions_unmet'
  | 'submErr_not_declined'
  | 'submSelectErr_submission_not_approved'
  | 'submSelectErr_submission_incomplete'
  | 'submSelectErr_submission_expired'
  | 'genericError';

/** Every 422 the ledger's routes emit, mapped to its sentence; anything else is the generic failure. */
export function submissionErrorKey(err: unknown): ErrorKey {
  if (!(err instanceof ApiError)) return 'genericError';
  const codes = new Set<string | undefined>([err.errorCode, err.code, ...(err.detailCodes ?? [])]);
  if (codes.has('lender_inactive')) return 'submSelectErr_lender_inactive';
  if (codes.has('invalid_reference')) return 'submErr_invalid_reference';
  if (codes.has('selected_terms_locked')) return 'submLockedHint';
  if (codes.has('conditions_unmet')) return 'submSelectErr_conditions_unmet';
  if (codes.has('not_declined')) return 'submErr_not_declined';
  if (codes.has('submission_not_approved')) return 'submSelectErr_submission_not_approved';
  if (codes.has('submission_incomplete')) return 'submSelectErr_submission_incomplete';
  if (codes.has('submission_expired')) return 'submSelectErr_submission_expired';
  return 'genericError';
}

const LENDER_FIELD_ERRORS: ReadonlySet<ErrorKey> = new Set<ErrorKey>([
  'submSelectErr_lender_inactive',
  'submErr_invalid_reference',
]);

/** Raw form text — parsed to cents/bps on submit, never stored as floats. */
interface FormDraft {
  lender_id: string;
  platform: SubmissionPlatformT;
  status: SubmissionStatusT;
  buy_rate: string;
  sell_rate: string;
  term: string;
  ceiling: string;
  payment: string;
  expiry: string;
  conditions: string;
  decline_reason: string;
  notes: string;
}

const EMPTY_FORM: FormDraft = {
  lender_id: '',
  platform: 'dealertrack',
  status: 'submitted',
  buy_rate: '',
  sell_rate: '',
  term: '',
  ceiling: '',
  payment: '',
  expiry: '',
  conditions: '',
  decline_reason: '',
  notes: '',
};

const money = (cents: number | null) => (cents === null ? '' : (cents / 100).toFixed(2));
const rate = (bps: number | null) => (bps === null ? '' : bpsToRateInput(bps));

function draftFromRow(row: DealSubmissionT): FormDraft {
  return {
    lender_id: row.lender_id,
    platform: row.platform,
    status: row.status,
    buy_rate: rate(row.buy_rate_bps),
    sell_rate: rate(row.sell_rate_bps),
    term: row.term_months === null ? '' : String(row.term_months),
    ceiling: money(row.approval_amount_cents),
    payment: money(row.monthly_payment_cents),
    expiry: row.expiry_date ?? '',
    conditions: row.conditions ?? '',
    decline_reason: row.decline_reason ?? '',
    notes: row.notes ?? '',
  };
}

/** '' → null (a cleared field), otherwise the parsed value; undefined = garbage. */
const bpsOrNull = (raw: string) => (raw.trim() === '' ? null : (parsePctToBps(raw) ?? undefined));
const centsOrNull = (raw: string) => (raw.trim() === '' ? null : (parseMoneyToCents(raw) ?? undefined));
const termOrNull = (raw: string) => {
  const s = raw.trim();
  if (s === '') return null;
  if (!/^\d+$/.test(s)) return undefined;
  const n = Number(s);
  return n >= 1 && n <= 120 ? n : undefined;
};
const textOrNull = (raw: string) => (raw.trim() === '' ? null : raw.trim());

/** The create body: only what was typed (no .default() anywhere, no status). */
function createBody(d: FormDraft): CreateSubmissionInputT {
  const buy = bpsOrNull(d.buy_rate);
  const sell = bpsOrNull(d.sell_rate);
  const term = termOrNull(d.term);
  const ceiling = centsOrNull(d.ceiling);
  const payment = centsOrNull(d.payment);
  const conditions = textOrNull(d.conditions);
  const notes = textOrNull(d.notes);
  return {
    lender_id: d.lender_id,
    platform: d.platform,
    ...(buy === null || buy === undefined ? {} : { buy_rate_bps: buy }),
    ...(sell === null || sell === undefined ? {} : { sell_rate_bps: sell }),
    ...(term === null || term === undefined ? {} : { term_months: term }),
    ...(ceiling === null || ceiling === undefined ? {} : { approval_amount_cents: ceiling }),
    ...(payment === null || payment === undefined ? {} : { monthly_payment_cents: payment }),
    ...(d.expiry === '' ? {} : { expiry_date: d.expiry }),
    ...(conditions === null ? {} : { conditions }),
    ...(notes === null ? {} : { notes }),
  };
}

/**
 * The PATCH body is a DIFF against the row: unchanged fields are not sent, so
 * the selected row's locked three (sell rate, term, lender) never travel
 * unless the person actually changed them — and the form disables them.
 * A decline reason travels only with a declined status (the server refuses
 * a reason on any other status; leaving declined clears it server-side).
 */
export function updateBody(row: DealSubmissionT, d: FormDraft): UpdateSubmissionInputT {
  const body: UpdateSubmissionInputT = {};
  if (d.status !== row.status) body.status = d.status;
  if (d.lender_id !== '' && d.lender_id !== row.lender_id) body.lender_id = d.lender_id;
  if (d.platform !== row.platform) body.platform = d.platform;
  const buy = bpsOrNull(d.buy_rate);
  if (buy !== undefined && buy !== row.buy_rate_bps) body.buy_rate_bps = buy;
  const sell = bpsOrNull(d.sell_rate);
  if (sell !== undefined && sell !== row.sell_rate_bps) body.sell_rate_bps = sell;
  const term = termOrNull(d.term);
  if (term !== undefined && term !== row.term_months) body.term_months = term;
  const ceiling = centsOrNull(d.ceiling);
  if (ceiling !== undefined && ceiling !== row.approval_amount_cents) body.approval_amount_cents = ceiling;
  const payment = centsOrNull(d.payment);
  if (payment !== undefined && payment !== row.monthly_payment_cents) body.monthly_payment_cents = payment;
  const expiry = d.expiry === '' ? null : d.expiry;
  if (expiry !== row.expiry_date) body.expiry_date = expiry;
  const conditions = textOrNull(d.conditions);
  if (conditions !== row.conditions) body.conditions = conditions;
  if (d.status === 'declined') {
    const reason = textOrNull(d.decline_reason);
    if (reason !== row.decline_reason) body.decline_reason = reason;
  }
  const notes = textOrNull(d.notes);
  if (notes !== row.notes) body.notes = notes;
  return body;
}

interface MutationView {
  isPending: boolean;
  error: unknown;
}

function SubmissionForm({
  editing,
  lenders,
  mutation,
  onSubmit,
  onCancel,
}: {
  /** null = the add form; a row = « Modification — {lender} ». */
  editing: { row: DealSubmissionT; lenderName: string } | null;
  lenders: ReturnType<typeof useLenders>;
  mutation: MutationView;
  onSubmit: (draft: FormDraft) => void;
  onCancel: (() => void) | null;
}) {
  const { t } = useTranslation('deals');
  const { t: tLenders } = useTranslation('lenders');
  const { t: tCommon } = useTranslation('common');
  const [draft, setDraft] = useState<FormDraft>(() => (editing ? draftFromRow(editing.row) : EMPTY_FORM));
  const locked = editing?.row.selected ?? false;

  function set<K extends keyof FormDraft>(key: K, value: FormDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  const buyInvalid = draft.buy_rate.trim() !== '' && parsePctToBps(draft.buy_rate) === null;
  const sellInvalid = draft.sell_rate.trim() !== '' && parsePctToBps(draft.sell_rate) === null;
  const termInvalid = draft.term.trim() !== '' && termOrNull(draft.term) === undefined;
  const ceilingInvalid = draft.ceiling.trim() !== '' && parseMoneyToCents(draft.ceiling) === null;
  const paymentInvalid = draft.payment.trim() !== '' && parseMoneyToCents(draft.payment) === null;
  const canSubmit =
    draft.lender_id !== '' &&
    !buyInvalid &&
    !sellInvalid &&
    !termInvalid &&
    !ceilingInvalid &&
    !paymentInvalid &&
    !mutation.isPending;

  const errorKey = mutation.error ? submissionErrorKey(mutation.error) : null;
  const lenderError = errorKey !== null && LENDER_FIELD_ERRORS.has(errorKey) ? t(errorKey) : null;
  const formError = errorKey !== null && lenderError === null ? t(errorKey) : null;

  // ACTIVE lenders only for a new pick; the row's CURRENT lender stays
  // selectable (suffixed « (inactif) » once deactivated) — the desk's own model.
  const lenderSelect = deskingLenderSelect(
    { isPending: lenders.isPending, isError: lenders.isError, items: lenders.data?.items },
    draft.lender_id,
    t('lenderInactiveSuffix'),
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit(draft);
  }

  const rateField = (
    id: string,
    label: string,
    key: 'buy_rate' | 'sell_rate',
    invalid: boolean,
    disabled: boolean,
  ) => (
    <div className="space-y-1">
      <Label htmlFor={id} optionalText={tCommon('optional')}>
        {label}
      </Label>
      <Input
        id={id}
        inputMode="decimal"
        value={draft[key]}
        disabled={disabled || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : disabled ? 'subm-locked-hint' : undefined}
        className={invalid ? 'border-danger-border' : undefined}
        onChange={(e) => set(key, e.target.value)}
      />
      {invalid ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger-text">
          {t('invalidRate')}
        </p>
      ) : null}
    </div>
  );

  const moneyField = (id: string, label: string, key: 'ceiling' | 'payment', invalid: boolean) => (
    <div className="space-y-1">
      <Label htmlFor={id} optionalText={tCommon('optional')}>
        {label}
      </Label>
      <Input
        id={id}
        inputMode="decimal"
        value={draft[key]}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : undefined}
        className={invalid ? 'border-danger-border' : undefined}
        onChange={(e) => set(key, e.target.value)}
      />
      {invalid ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger-text">
          {t('invalidAmount')}
        </p>
      ) : null}
    </div>
  );

  return (
    <form onSubmit={submit} noValidate className="space-y-3 border-t border-border pt-3">
      <h3 className="text-sm font-semibold">
        {editing ? t('submEditing', { lender: editing.lenderName }) : t('submAdd')}
      </h3>
      {locked ? (
        <p id="subm-locked-hint" className="text-xs text-muted-foreground">
          {t('submLockedHint')}
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="subm-lender">{t('submLenderLabel')}</Label>
          <Select
            id="subm-lender"
            value={draft.lender_id}
            disabled={lenderSelect.disabled || locked || undefined}
            required
            aria-invalid={lenderError ? true : undefined}
            aria-describedby={lenderError ? 'subm-lender-error' : locked ? 'subm-locked-hint' : undefined}
            className={lenderError ? 'border-danger-border' : undefined}
            onChange={(e) => set('lender_id', e.target.value)}
          >
            <option value="">{t('lenderNone')}</option>
            {lenderSelect.current ? (
              <option value={lenderSelect.current.value}>{lenderSelect.current.label}</option>
            ) : null}
            {lenderSelect.groups.map((g) => (
              <optgroup key={g.category} label={tLenders(CATEGORY_KEYS[g.category])}>
                {g.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
          {lenderError ? (
            <p id="subm-lender-error" role="alert" className="text-xs text-danger-text">
              {lenderError}
            </p>
          ) : null}
        </div>
        <div className="space-y-1">
          <Label htmlFor="subm-platform">{t('submPlatformLabel')}</Label>
          <Select
            id="subm-platform"
            value={draft.platform}
            onChange={(e) => set('platform', e.target.value as SubmissionPlatformT)}
          >
            {SUBMISSION_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {t(SUBMISSION_PLATFORM_KEYS[p])}
              </option>
            ))}
          </Select>
        </div>
        {editing ? (
          <div className="space-y-1">
            <Label htmlFor="subm-status">{t('submStatusLabel')}</Label>
            <Select
              id="subm-status"
              value={draft.status}
              onChange={(e) => set('status', e.target.value as SubmissionStatusT)}
            >
              {SUBMISSION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(SUBMISSION_STATUS_KEYS[s])}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        {rateField('subm-buy', t('submBuyRate'), 'buy_rate', buyInvalid, false)}
        {rateField('subm-sell', t('submSellRate'), 'sell_rate', sellInvalid, locked)}
        <div className="space-y-1">
          <Label htmlFor="subm-term" optionalText={tCommon('optional')}>
            {t('submTerm')}
          </Label>
          <Input
            id="subm-term"
            inputMode="numeric"
            value={draft.term}
            disabled={locked || undefined}
            aria-invalid={termInvalid || undefined}
            aria-describedby={termInvalid ? 'subm-term-error' : locked ? 'subm-locked-hint' : undefined}
            className={termInvalid ? 'border-danger-border' : undefined}
            onChange={(e) => set('term', e.target.value)}
          />
          {termInvalid ? (
            <p id="subm-term-error" role="alert" className="text-xs text-danger-text">
              {t('invalidTerm')}
            </p>
          ) : null}
        </div>
        {moneyField('subm-ceiling', t('submCeiling'), 'ceiling', ceilingInvalid)}
        {moneyField('subm-payment', t('submPayment'), 'payment', paymentInvalid)}
        <div className="space-y-1">
          <Label htmlFor="subm-expiry" optionalText={tCommon('optional')}>
            {t('submExpiryLabel')}
          </Label>
          <Input id="subm-expiry" type="date" value={draft.expiry} onChange={(e) => set('expiry', e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="subm-conditions" optionalText={tCommon('optional')}>
            {t('submConditions')}
          </Label>
          <Input
            id="subm-conditions"
            value={draft.conditions}
            maxLength={1000}
            onChange={(e) => set('conditions', e.target.value)}
          />
        </div>
        {editing && draft.status === 'declined' ? (
          <div className="space-y-1">
            <Label htmlFor="subm-reason" optionalText={tCommon('optional')}>
              {t('submDeclineReason')}
            </Label>
            <Input
              id="subm-reason"
              value={draft.decline_reason}
              maxLength={500}
              onChange={(e) => set('decline_reason', e.target.value)}
            />
          </div>
        ) : null}
        <div className="space-y-1">
          <Label htmlFor="subm-notes" optionalText={tCommon('optional')}>
            {t('submNotes')}
          </Label>
          <Input id="subm-notes" value={draft.notes} maxLength={1000} onChange={(e) => set('notes', e.target.value)} />
        </div>
      </div>
      {formError ? (
        <p role="alert" className="text-sm text-danger-text">
          {formError}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!canSubmit}>
          {mutation.isPending ? t('submSaving') : editing ? t('submSave') : t('submAddAction')}
        </Button>
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('submCancel')}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/** A warning/caution/danger chip: icon + text, never colour alone. */
function Chip({ tone, children }: { tone: 'warning' | 'caution' | 'danger'; children: string }) {
  const classes =
    tone === 'warning'
      ? 'bg-warning-bg text-warning-text'
      : tone === 'caution'
        ? 'bg-caution-bg text-caution-text'
        : 'text-danger-text';
  return (
    <span role="status" className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${classes}`}>
      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5 shrink-0" fill="currentColor">
        <path d="M8 1.5 15 14H1L8 1.5Zm0 3.2L3.4 12.5h9.2L8 4.7Zm-.7 3h1.4v3H7.3v-3Zm0 3.8h1.4v1.4H7.3v-1.4Z" />
      </svg>
      {children}
    </span>
  );
}

export function SubmissionsPanelView({
  dealId,
  orgId,
  live,
  amountFinancedCents,
  dealType,
  onPromoted,
  mode,
  onModeChange,
}: SubmissionsPanelProps & { mode: PanelMode; onModeChange: (mode: PanelMode) => void }) {
  const { t, i18n } = useTranslation('deals');
  const locale = i18n.language;
  const mine = usePermissionsMine(orgId);
  const canWrite = can(mine.data, 'deal:update');
  // The same key the page already holds (includeInactive) — no extra GET.
  const lenders = useLenders(orgId, { includeInactive: true });
  const rows = useSubmissions(dealId);
  const create = useCreateSubmission(dealId);
  const update = useUpdateSubmission(dealId);
  const select = useSelectSubmission(dealId, { onPromoted });

  const lenderOf = (id: string): LenderT | undefined => lenders.data?.items.find((l) => l.id === id);
  const lenderName = (id: string): string => {
    const l = lenderOf(id);
    if (!l) return '…';
    return l.active ? l.name : `${l.name} ${t('lenderInactiveSuffix')}`;
  };
  const fmtDate = (d: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
  /**
   * The card's terms line, one shape per what the lender has answered so
   * far: the full triple as « {ceiling} @ {sell} × {term} mois »; sell + term
   * with the ceiling to follow as « {sell} × {term} mois »; otherwise the
   * ceiling and/or the term on their own. A field is never hidden because a
   * sibling is blank — the term is one of the three values promotion writes
   * onto the deal, and the person choosing must have read it here first. A
   * lone sell rate already lives on the rates line, so it makes no terms line.
   */
  function termsLineOf(row: DealSubmissionT): string | null {
    const ceiling = row.approval_amount_cents === null ? null : formatCents(row.approval_amount_cents, locale);
    const sell = row.sell_rate_bps === null ? null : formatBps(row.sell_rate_bps, locale);
    const term = row.term_months;
    if (ceiling !== null && sell !== null && term !== null) return t('submTermsLine', { ceiling, sell, term });
    if (ceiling === null && sell !== null && term !== null) return t('submTermsLineNoCeiling', { sell, term });
    const parts: string[] = [];
    if (ceiling !== null) parts.push(t('submCeilingOnly', { ceiling }));
    if (term !== null) parts.push(t('submTermOnly', { term }));
    return parts.length === 0 ? null : parts.join(' · ');
  }

  const pct = (bps: number | null) => (bps === null ? '—' : formatBps(bps, locale));

  function setMode(next: PanelMode) {
    create.reset();
    update.reset();
    onModeChange(next);
  }

  function submitAdd(draft: FormDraft) {
    create
      .mutateAsync(createBody(draft))
      .then(() => setMode('closed'))
      .catch((err: unknown) => {
        if (!(err instanceof ApiError)) throw err;
      });
  }

  function submitEdit(row: DealSubmissionT, draft: FormDraft) {
    const body = updateBody(row, draft);
    if (Object.keys(body).length === 0) {
      setMode('closed');
      return;
    }
    update
      .mutateAsync({ id: row.id, body })
      .then(() => setMode('closed'))
      .catch((err: unknown) => {
        if (!(err instanceof ApiError)) throw err;
      });
  }

  function toggleConditionsMet(row: DealSubmissionT, met: boolean) {
    update.mutateAsync({ id: row.id, body: { conditions_met: met } }).catch((err: unknown) => {
      if (!(err instanceof ApiError)) throw err;
    });
  }

  function choose(row: DealSubmissionT) {
    select.mutateAsync(row.id).catch((err: unknown) => {
      if (!(err instanceof ApiError)) throw err;
    });
  }

  const items = rows.data ?? [];
  const editingRow = typeof mode === 'object' ? items.find((r) => r.id === mode.edit) : undefined;
  // A writer with an empty ledger gets the add form open — the CTA is walkable.
  const effectiveMode: PanelMode =
    mode === 'closed' && rows.isSuccess && items.length === 0 ? 'add' : mode;
  const editKey = typeof effectiveMode === 'object' ? `edit:${effectiveMode.edit}` : effectiveMode;

  return (
    <section aria-labelledby="subm-heading" className="space-y-3 rounded-lg border border-border bg-card p-4">
      <h2 id="subm-heading" className="text-[15px] font-semibold">
        {t('submSection')}
      </h2>

      {mine.isSuccess && !canWrite ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('submReadOnly')}
        </p>
      ) : null}

      {rows.isPending ? (
        <p className="text-sm text-muted-foreground" aria-busy="true">
          {t('loading')}
        </p>
      ) : rows.isError ? (
        <p role="alert" className="text-sm text-danger-text">
          {t('loadError')}
        </p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{canWrite ? t('submEmptyCta') : t('submEmpty')}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((row) => {
            const name = lenderName(row.lender_id);
            const sel = selectability(row, canWrite);
            const reasonId = `subm-reason-${row.id}`;
            const rowSelectError = select.error && select.variables === row.id ? t(submissionErrorKey(select.error)) : null;
            const rowToggleError =
              update.error && update.variables?.id === row.id && editingRow?.id !== row.id
                ? t(submissionErrorKey(update.error))
                : null;
            const overCeiling = ceilingExceeded(row, amountFinancedCents, dealType);
            const differs = deskDiffers(row, live);
            const termsLine = termsLineOf(row);
            return (
              <li
                key={row.id}
                className={`space-y-2 rounded-md border p-3 text-sm ${row.selected ? 'border-primary-text' : 'border-border'}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium">{name}</h3>
                  <span className="text-muted-foreground">· {t(SUBMISSION_PLATFORM_KEYS[row.platform])}</span>
                  <span className="inline-flex rounded-md bg-secondary px-2 py-0.5 text-[11px] font-semibold text-secondary-foreground">
                    {t(SUBMISSION_STATUS_KEYS[row.status])}
                  </span>
                  {row.selected ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-foreground">
                      <span aria-hidden="true">★</span>
                      {t('submSelected')}
                    </span>
                  ) : null}
                  {row.expired ? (
                    <Chip tone="danger">{t('submExpired')}</Chip>
                  ) : row.expiry_date !== null ? (
                    <span className="text-xs text-muted-foreground">{t('submExpires', { date: fmtDate(row.expiry_date) })}</span>
                  ) : null}
                </div>
                {termsLine !== null ? <p className="font-mono text-[13px] tabular-nums">{termsLine}</p> : null}
                <p className="text-muted-foreground">
                  {t('submRates', {
                    buy: pct(row.buy_rate_bps),
                    sell: pct(row.sell_rate_bps),
                    spread: pct(spreadBps(row.buy_rate_bps, row.sell_rate_bps)),
                  })}
                </p>
                {row.monthly_payment_cents !== null ? (
                  <p className="text-muted-foreground">
                    {t('submLenderQuote', { amount: formatCents(row.monthly_payment_cents, locale) })}
                  </p>
                ) : null}
                {row.conditions !== null && row.conditions !== '' ? (
                  <div className="space-y-1">
                    <p>
                      <span className="text-muted-foreground">{t('submConditions')} : </span>
                      {row.conditions}
                    </p>
                    {canWrite ? (
                      <label htmlFor={`subm-met-${row.id}`} className="flex items-center gap-2 text-sm max-lg:min-h-11">
                        <input
                          id={`subm-met-${row.id}`}
                          type="checkbox"
                          checked={row.conditions_met}
                          disabled={update.isPending || undefined}
                          onChange={(e) => toggleConditionsMet(row, e.target.checked)}
                          className="size-4 accent-primary-text"
                        />
                        {t('submConditionsMet')}
                      </label>
                    ) : row.conditions_met ? (
                      <p className="text-xs text-muted-foreground">{t('submConditionsMet')}</p>
                    ) : null}
                  </div>
                ) : null}
                {row.status === 'declined' && row.decline_reason !== null ? (
                  <p>
                    <span className="text-muted-foreground">{t('submDeclineReason')} : </span>
                    {row.decline_reason}
                  </p>
                ) : null}
                {row.notes !== null && row.notes !== '' ? (
                  <p className="text-xs text-muted-foreground">{row.notes}</p>
                ) : null}
                {overCeiling && row.approval_amount_cents !== null ? (
                  <Chip tone="warning">
                    {t('submCeilingExceeded', { amount: formatCents(row.approval_amount_cents, locale) })}
                  </Chip>
                ) : null}
                {differs ? <Chip tone="caution">{t('submDeskDiffers')}</Chip> : null}
                {sel.rendered ? (
                  <div className="space-y-1">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={!sel.enabled || select.isPending}
                        aria-label={t('submSelectActionFor', { lender: name })}
                        aria-describedby={sel.reasonKey ? reasonId : undefined}
                        onClick={() => choose(row)}
                      >
                        {t('submSelectAction')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        aria-label={t('submEditFor', { lender: name })}
                        onClick={() => setMode({ edit: row.id })}
                      >
                        {t('submEdit')}
                      </Button>
                    </div>
                    {sel.reasonKey ? (
                      <p id={reasonId} className="text-xs text-muted-foreground">
                        {sel.reasonKey === 'submSelectErr_submission_not_approved' && row.status === 'conditional'
                          ? t('submConditionalHint')
                          : t(sel.reasonKey)}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {rowSelectError ?? rowToggleError ? (
                  <p role="alert" className="text-xs text-danger-text">
                    {rowSelectError ?? rowToggleError}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {canWrite && rows.isSuccess ? (
        effectiveMode === 'closed' ? (
          <Button type="button" variant="outline" onClick={() => setMode('add')}>
            {t('submAdd')}
          </Button>
        ) : effectiveMode === 'add' || !editingRow ? (
          <SubmissionForm
            key={editKey}
            editing={null}
            lenders={lenders}
            mutation={create}
            onSubmit={submitAdd}
            onCancel={items.length === 0 ? null : () => setMode('closed')}
          />
        ) : (
          <SubmissionForm
            key={editKey}
            editing={{ row: editingRow, lenderName: lenderName(editingRow.lender_id) }}
            lenders={lenders}
            mutation={update}
            onSubmit={(draft) => submitEdit(editingRow, draft)}
            onCancel={() => setMode('closed')}
          />
        )
      ) : null}
    </section>
  );
}

export function SubmissionsPanel(props: SubmissionsPanelProps) {
  const [mode, setMode] = useState<PanelMode>('closed');
  return <SubmissionsPanelView {...props} mode={mode} onModeChange={setMode} />;
}
