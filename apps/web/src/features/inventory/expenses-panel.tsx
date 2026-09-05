import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Label, Select } from '@dealpilot/ui';
import {
  EXPENSE_CATEGORIES,
  type ExpenseCategoryT,
  type ExpenseStatusT,
  type VehicleExpenseT,
  type VehicleExpensesResultT,
} from '@dealpilot/schemas';
import { ApiError } from '../../shared/api/client.js';
import { can, usePermissionsMine } from '../../shared/permissions.js';
import { formatCents, parseMoneyToCents } from '../deals/money.js';
import { fetchReceipt, useLogExpense, useUpdateExpense, useUploadReceipt } from './expenses-api.js';
import {
  EXPENSE_CATEGORY_KEYS,
  EXPENSE_STATUS_KEYS,
  draftToBody,
  expenseErrorKey,
  legalMoves,
  todayLocal,
  voidStep,
  type ExpenseDraft,
  type MoveTarget,
} from './expenses-model.js';

/**
 * F-82 — « Dépenses du véhicule »: the vehicle page's third block, the
 * ledger of what a car cost AFTER purchase (expenses-accounting.md §1–§5,
 * D-084). A record and a report input, never a desk input: nothing here
 * reaches the vehicle's own cost fields, the desk or pay; the page adds the
 * approved sum beside the derived total in ONE captioned row of its own.
 *
 * Permission posture: logging, editing-while-pending and the receipt run
 * under `vehicle:update` (`canLog`); approve / reject / pay / void — the
 * pending retract included — under `expense:approve` (`canApprove`).
 * `usePermissionsMine` is owned here because the vehicle page queries no
 * permissions. Zero-request law: without a verb no write control exists —
 * the reader sees the rows plus one sentence, every mutation hook stays
 * idle. The sentence renders only once the answer is in
 * (`mine.isSuccess && !canLog && !canApprove`), so a writer never sees it.
 *
 * The masking law (FR-TEN-006): the money line, the pending line and the
 * receipt controls render only when the list carries `summary` — a masked
 * viewer sees rows without money and never a « 0,00 $ ». A masked HOLDER of
 * `vehicle:update` still gets the add form and « Modifier — » (the shipped
 * recon asymmetry: write authority ≠ read authority) but no receipt input —
 * a receipt IS the amount (recorded, A33).
 *
 * ONE form at a time (`mode`): « Modifier — {vendor} » replaces the add form
 * so no label appears twice on the page. The void button is the house's
 * inline two-step: the SAME button relabels to « Confirmer l’annulation — »
 * and resets on blur (`confirmVoidId`); focus never moves. The container
 * owns both states; the view is exported so the static harness can open the
 * editor and arm the void.
 */

export type PanelMode = 'closed' | 'add' | { readonly edit: string };

/** The page's ONE list GET, shared with the strip rows — the shape the panel reads. */
export interface ExpensesQuery {
  data: VehicleExpensesResultT | undefined;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
}

export interface ExpensesPanelProps {
  vehicleId: string;
  orgId: string;
  list: ExpensesQuery;
}

const EMPTY_DRAFT = (): ExpenseDraft => ({
  category: 'detail',
  vendor_name: '',
  amount: '',
  tax: '',
  expense_date: todayLocal(),
  invoice_number: '',
  description: '',
});

function draftFromRow(row: VehicleExpenseT): ExpenseDraft {
  return {
    category: row.category,
    vendor_name: row.vendor_name,
    // Never shown in edit mode (the amount is fixed at entry) — kept so a
    // diff body is computed against the row, never against blanks.
    amount: '',
    tax: '',
    expense_date: row.expense_date,
    invoice_number: row.invoice_number ?? '',
    description: row.description ?? '',
  };
}

/** Status chips: text carries the meaning, the F-75 token PAIR underlines it. */
const CHIP_CLASSES: Record<ExpenseStatusT, string> = {
  pending: 'bg-muted text-muted-foreground',
  approved: 'bg-success-bg text-success-text',
  paid: 'bg-success-bg text-success-text',
  rejected: 'bg-danger-bg text-danger-text',
  void: 'bg-danger-bg text-danger-text',
};

/** The moves' labels — the visible verb and its « — {vendor} » accessible name. */
const MOVE_KEYS = {
  approved: { action: 'expApproveAction', named: 'expApprove' },
  rejected: { action: 'expRejectAction', named: 'expReject' },
  paid: { action: 'expPayAction', named: 'expPay' },
} as const satisfies Record<Exclude<MoveTarget, 'void'>, { action: string; named: string }>;

interface MutationView {
  isPending: boolean;
  error: unknown;
}

function ExpenseForm({
  editing,
  draft: typed,
  onDraftChange,
  mutation,
  onSubmit,
  onCancel,
}: {
  /** null = the add form; a row = « Modification — {vendor} » with the money fixed. */
  editing: VehicleExpenseT | null;
  /** The container's draft (null = untouched: the row's values, or the blank form dated today). */
  draft: ExpenseDraft | null;
  onDraftChange: (draft: ExpenseDraft) => void;
  mutation: MutationView;
  onSubmit: (draft: ExpenseDraft) => void;
  onCancel: (() => void) | null;
}) {
  const { t } = useTranslation('inventory');
  const { t: tCommon } = useTranslation('common');
  // Controlled by the container so typed values survive a failed save and a
  // re-render alike; the first keystroke materialises the draft.
  const draft = typed ?? (editing ? draftFromRow(editing) : EMPTY_DRAFT());

  function set<K extends keyof ExpenseDraft>(key: K, value: ExpenseDraft[K]) {
    onDraftChange({ ...draft, [key]: value });
  }

  const amountInvalid = draft.amount.trim() !== '' && parseMoneyToCents(draft.amount) === null;
  const taxInvalid = draft.tax.trim() !== '' && parseMoneyToCents(draft.tax) === null;
  const canSubmit =
    draft.vendor_name.trim() !== '' &&
    draft.expense_date !== '' &&
    (editing !== null || (draft.amount.trim() !== '' && !amountInvalid)) &&
    !taxInvalid &&
    !mutation.isPending;

  const formError = mutation.error ? t(expenseErrorKey(mutation.error)) : null;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit(draft);
  }

  // The vehicle page's own recon-input idiom (A26): decimal keyboard,
  // aria-invalid, and the sentence wired through aria-describedby.
  const moneyField = (id: 'exp-amount' | 'exp-tax', label: string, key: 'amount' | 'tax', invalid: boolean, optional: boolean) => (
    <div className="space-y-1">
      <Label htmlFor={id} optionalText={optional ? tCommon('optional') : undefined}>
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
        {editing ? t('expEditing', { vendor: editing.vendor_name }) : t('expLogTitle')}
      </h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="exp-category">{t('expCategory')}</Label>
          <Select id="exp-category" value={draft.category} onChange={(e) => set('category', e.target.value as ExpenseCategoryT)}>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(EXPENSE_CATEGORY_KEYS[c])}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="exp-vendor">{t('expVendor')}</Label>
          <Input
            id="exp-vendor"
            value={draft.vendor_name}
            maxLength={120}
            required
            onChange={(e) => set('vendor_name', e.target.value)}
          />
        </div>
        {editing ? (
          <p id="exp-money-fixed" className="text-xs text-muted-foreground sm:col-span-2">
            {t('expMoneyFixed')}
          </p>
        ) : (
          <>
            {moneyField('exp-amount', t('expAmount'), 'amount', amountInvalid, false)}
            {moneyField('exp-tax', t('expTax'), 'tax', taxInvalid, true)}
          </>
        )}
        <div className="space-y-1">
          <Label htmlFor="exp-date">{t('expDate')}</Label>
          <Input
            id="exp-date"
            type="date"
            value={draft.expense_date}
            required
            onChange={(e) => set('expense_date', e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="exp-invoice" optionalText={tCommon('optional')}>
            {t('expInvoice')}
          </Label>
          <Input
            id="exp-invoice"
            value={draft.invoice_number}
            maxLength={60}
            onChange={(e) => set('invoice_number', e.target.value)}
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="exp-description" optionalText={tCommon('optional')}>
            {t('expDescription')}
          </Label>
          <Input
            id="exp-description"
            value={draft.description}
            maxLength={500}
            onChange={(e) => set('description', e.target.value)}
          />
        </div>
      </div>
      {formError ? (
        <p role="alert" className="text-sm text-danger-text">
          {formError}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!canSubmit}>
          {mutation.isPending ? t('saving') : t('expSave')}
        </Button>
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('expCancel')}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

export function ExpensesPanelView({
  vehicleId,
  orgId,
  list,
  mode,
  onModeChange,
  draft,
  onDraftChange,
  confirmVoidId,
  onConfirmVoidChange,
}: ExpensesPanelProps & {
  mode: PanelMode;
  onModeChange: (mode: PanelMode) => void;
  /** The open form's typed values (null = untouched). Cleared whenever the mode changes. */
  draft: ExpenseDraft | null;
  onDraftChange: (draft: ExpenseDraft | null) => void;
  /** The row whose void button is armed (relabelled), or null. */
  confirmVoidId: string | null;
  onConfirmVoidChange: (id: string | null) => void;
}) {
  const { t, i18n } = useTranslation('inventory');
  const locale = i18n.language;
  const mine = usePermissionsMine(orgId);
  const canLog = can(mine.data, 'vehicle:update');
  const canApprove = can(mine.data, 'expense:approve');
  const log = useLogExpense(vehicleId);
  const update = useUpdateExpense(vehicleId);
  const upload = useUploadReceipt(vehicleId);
  const [viewError, setViewError] = useState<{ id: string; message: string } | null>(null);

  const items = list.data?.items ?? [];
  const summary = list.data?.summary;
  const fmtDate = (d: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));

  function setMode(next: PanelMode) {
    log.reset();
    update.reset();
    onDraftChange(null);
    onModeChange(next);
  }

  function submitAdd(draft: ExpenseDraft) {
    const out = draftToBody(draft, null);
    if (out === null || out.kind !== 'create') return;
    log
      .mutateAsync(out.body)
      .then(() => setMode('closed'))
      .catch((err: unknown) => {
        if (!(err instanceof ApiError)) throw err;
      });
  }

  function submitEdit(row: VehicleExpenseT, draft: ExpenseDraft) {
    const out = draftToBody(draft, row);
    if (out === null) {
      setMode('closed');
      return;
    }
    if (out.kind !== 'update') return;
    update
      .mutateAsync({ id: row.id, body: out.body })
      .then(() => setMode('closed'))
      .catch((err: unknown) => {
        if (!(err instanceof ApiError)) throw err;
      });
  }

  function move(row: VehicleExpenseT, status: ExpenseStatusT) {
    update.mutateAsync({ id: row.id, body: { status } }).catch((err: unknown) => {
      if (!(err instanceof ApiError)) throw err;
    });
  }

  function onVoid(row: VehicleExpenseT, event: 'click' | 'blur') {
    const step = voidStep(event, confirmVoidId, row.id);
    onConfirmVoidChange(step.next);
    if (step.send) move(row, 'void');
  }

  function attach(row: VehicleExpenseT, file: File) {
    upload.mutateAsync({ id: row.id, file }).catch((err: unknown) => {
      if (!(err instanceof ApiError)) throw err;
    });
  }

  async function view(row: VehicleExpenseT) {
    setViewError(null);
    // Open the tab NOW, inside the click gesture — Safari blocks a window.open
    // that runs after an await (documents-dialog.tsx' idiom).
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    try {
      const url = await fetchReceipt(row.id);
      if (tab) tab.location.href = url;
      else window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      tab?.close();
      setViewError({ id: row.id, message: t(expenseErrorKey(err)) });
      if (!(err instanceof ApiError)) throw err;
    }
  }

  const editingRow = typeof mode === 'object' ? items.find((r) => r.id === mode.edit) : undefined;
  // A writer with an empty ledger gets the add form open — the CTA is walkable.
  const effectiveMode: PanelMode = mode === 'closed' && list.isSuccess && items.length === 0 ? 'add' : mode;
  return (
    <section aria-labelledby="exp-heading" className="space-y-3 rounded-lg border border-border bg-card p-4">
      <h2 id="exp-heading" className="text-[15px] font-semibold">
        {t('expSection')}
      </h2>

      {summary !== undefined && summary.pending_cents > 0 ? (
        <p className="text-sm text-muted-foreground">{t('expPending', { amount: formatCents(summary.pending_cents, locale) })}</p>
      ) : null}

      {mine.isSuccess && !canLog && !canApprove ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('expReadOnly')}
        </p>
      ) : null}

      {list.isPending ? (
        <p className="text-sm text-muted-foreground" aria-busy="true">
          {t('loading')}
        </p>
      ) : list.isError ? (
        <p role="alert" className="text-sm text-danger-text">
          {t('loadError')}
        </p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{canLog ? t('expEmptyCta') : t('expEmpty')}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((row) => {
            const vendor = row.vendor_name;
            const moves = legalMoves(row.status, canApprove);
            const armed = confirmVoidId === row.id;
            const hasMoney = row.amount_cents !== undefined && row.tax_cents !== undefined && row.total_cents !== undefined;
            const hasReceipt = typeof row.receipt_content_sha256 === 'string';
            const mayAttach = canLog && summary !== undefined && row.status !== 'rejected' && row.status !== 'void';
            const rowMoveError =
              update.error && update.variables?.id === row.id && editingRow?.id !== row.id
                ? t(expenseErrorKey(update.error))
                : null;
            const rowUploadError = upload.error && upload.variables?.id === row.id ? t(expenseErrorKey(upload.error)) : null;
            const rowViewError = viewError?.id === row.id ? viewError.message : null;
            return (
              <li key={row.id} className="space-y-2 rounded-md border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium">
                    {t(EXPENSE_CATEGORY_KEYS[row.category])} — {vendor}
                  </h3>
                  <span role="status" className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold ${CHIP_CLASSES[row.status]}`}>
                    {t(EXPENSE_STATUS_KEYS[row.status])}
                  </span>
                </div>
                <p className="text-muted-foreground">
                  {fmtDate(row.expense_date)}
                  {row.invoice_number !== null ? ` · ${t('expInvoiceLine', { invoice: row.invoice_number })}` : ''}
                </p>
                {hasMoney ? (
                  <p className="font-mono text-[13px] tabular-nums">
                    {t('expMoney', {
                      amount: formatCents(row.amount_cents!, locale),
                      tax: formatCents(row.tax_cents!, locale),
                      sum: formatCents(row.total_cents!, locale),
                    })}
                  </p>
                ) : null}
                {row.description !== null && row.description !== '' ? (
                  <p className="text-xs text-muted-foreground">{row.description}</p>
                ) : null}
                {hasReceipt ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t('expReceiptView', { vendor })}
                    onClick={() => void view(row)}
                  >
                    {t('expReceiptViewAction')}
                  </Button>
                ) : null}
                {moves.length > 0 || (canLog && row.status === 'pending') || mayAttach ? (
                  <div className="flex flex-wrap gap-2">
                    {moves.map((next) =>
                      next === 'void' ? (
                        // Two clicks on purpose: the same button relabels, then sends; blur disarms.
                        <Button
                          key={next}
                          type="button"
                          size="sm"
                          variant={armed ? 'destructive' : 'ghost'}
                          disabled={update.isPending}
                          aria-label={t(armed ? 'expVoidConfirm' : 'expVoid', { vendor })}
                          onClick={() => onVoid(row, 'click')}
                          onBlur={() => onVoid(row, 'blur')}
                        >
                          {t(armed ? 'expVoidConfirmAction' : 'expVoidAction')}
                        </Button>
                      ) : (
                        <Button
                          key={next}
                          type="button"
                          size="sm"
                          variant={next === 'rejected' ? 'outline' : 'default'}
                          disabled={update.isPending}
                          aria-label={t(MOVE_KEYS[next].named, { vendor })}
                          onClick={() => move(row, next)}
                        >
                          {t(MOVE_KEYS[next].action)}
                        </Button>
                      ),
                    )}
                    {canLog && row.status === 'pending' ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        aria-label={t('expEdit', { vendor })}
                        onClick={() => setMode({ edit: row.id })}
                      >
                        {t('expEditAction')}
                      </Button>
                    ) : null}
                    {mayAttach ? (
                      <label className="inline-flex h-9 cursor-pointer items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-muted has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring max-lg:min-h-11 max-lg:min-w-11">
                        {t('expReceiptUploadAction')}
                        <input
                          type="file"
                          accept="application/pdf,image/jpeg,image/png"
                          className="sr-only"
                          aria-label={t('expReceiptUpload', { vendor })}
                          disabled={upload.isPending}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = '';
                            if (file) attach(row, file);
                          }}
                        />
                      </label>
                    ) : null}
                  </div>
                ) : null}
                {rowMoveError ?? rowUploadError ?? rowViewError ? (
                  <p role="alert" className="text-xs text-danger-text">
                    {rowMoveError ?? rowUploadError ?? rowViewError}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {canLog && list.isSuccess ? (
        effectiveMode === 'closed' ? (
          <Button type="button" variant="outline" onClick={() => setMode('add')}>
            {t('expLogTitle')}
          </Button>
        ) : effectiveMode === 'add' || !editingRow ? (
          <ExpenseForm
            editing={null}
            draft={draft}
            onDraftChange={onDraftChange}
            mutation={log}
            onSubmit={submitAdd}
            onCancel={items.length === 0 ? null : () => setMode('closed')}
          />
        ) : (
          <ExpenseForm
            editing={editingRow}
            draft={draft}
            onDraftChange={onDraftChange}
            mutation={update}
            onSubmit={(draft) => submitEdit(editingRow, draft)}
            onCancel={() => setMode('closed')}
          />
        )
      ) : null}
    </section>
  );
}

export function ExpensesPanel(props: ExpensesPanelProps) {
  const [mode, setMode] = useState<PanelMode>('closed');
  const [draft, setDraft] = useState<ExpenseDraft | null>(null);
  const [confirmVoidId, setConfirmVoidId] = useState<string | null>(null);
  return (
    <ExpensesPanelView
      {...props}
      mode={mode}
      onModeChange={setMode}
      draft={draft}
      onDraftChange={setDraft}
      confirmVoidId={confirmVoidId}
      onConfirmVoidChange={setConfirmVoidId}
    />
  );
}
