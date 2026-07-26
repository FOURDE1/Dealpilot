import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, DialogContent, DialogTitle, Input, Label, Select } from '@dealpilot/ui';
import { DispatchType, type DealT } from '@dealpilot/schemas';
import { ApiError } from '../../shared/api/client.js';
import { parseMoneyToCents } from '../deals/money.js';
import { useDealDocuments } from '../documents/api.js';
import { docPrepared, documentDisplayName } from '../documents/labels.js';
import { useBookDispatch, useDriverCompanies } from './api.js';
import { DISPATCH_TYPE_KEYS } from './dispatch-page.js';

/**
 * Book the run for a deal. The server picks the plate and chaser (and flags —
 * never blocks on — conflicts); this form carries only what a human knows.
 */
export function BookDispatchDialog({
  deal,
  dealLabel,
  onClose,
}: {
  deal: DealT | null;
  dealLabel?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation('dispatch');
  const { t: tCommon } = useTranslation('common');
  const { t: tDocs } = useTranslation('documents');
  const companies = useDriverCompanies(deal?.organization_id, { enabled: deal !== null });
  // F-13: the booking gate reads the deal's documents — fetch them so the
  // refusal can NAME what is missing in the user's language, and warn before
  // the form is even filled. Reading also generates the list server-side, so
  // the gate is armed for every deal someone tries to book.
  const documents = useDealDocuments(deal?.id ?? '', { enabled: deal !== null });
  const unprepared = (documents.data?.items ?? []).filter((d) => !docPrepared(d));
  const book = useBookDispatch();
  const [type, setType] = useState<'delivery' | 'pickup' | 'transfer'>('delivery');
  const [companyId, setCompanyId] = useState('');
  const [when, setWhen] = useState('');
  const [pickup, setPickup] = useState('');
  const [delivery, setDelivery] = useState('');
  const [cash, setCash] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const cashInvalid = cash.trim() !== '' && parseMoneyToCents(cash) === null;

  function reset() {
    setType('delivery');
    setCompanyId('');
    setWhen('');
    setPickup('');
    setDelivery('');
    setCash('');
    setNotes('');
    setError(null);
  }

  async function handleBook() {
    if (!deal) return;
    setError(null);
    const cashCents = cash.trim() === '' ? undefined : parseMoneyToCents(cash);
    if (cashCents === null) return;
    try {
      await book.mutateAsync({
        deal_id: deal.id,
        dispatch_type: type,
        ...(companyId === '' ? {} : { driver_company_id: companyId }),
        ...(when === '' ? {} : { booked_delivery_at: new Date(when).toISOString() }),
        ...(pickup.trim() === '' ? {} : { pickup_address: pickup.trim() }),
        ...(delivery.trim() === '' ? {} : { delivery_address: delivery.trim() }),
        ...(cashCents === undefined ? {} : { cash_to_collect_cents: cashCents }),
        ...(notes.trim() === '' ? {} : { special_instructions: notes.trim() }),
      });
      reset();
      onClose();
    } catch (err) {
      if (!(err instanceof ApiError)) {
        setError(t('genericError'));
        throw err;
      }
      // F-13: the gate names each unprinted document. The server just judged
      // the file — refetch and name from FRESH truth (translated), falling
      // back to the server's own names, then to the plain sentence for
      // pre-F-13 deals where only the checklist tick exists.
      if (err.status === 422 && (err.errorCode === 'wet_ink_not_ready' || err.code === 'wet_ink_not_ready')) {
        const fresh = await documents.refetch();
        const freshNames = (fresh.data?.items ?? [])
          .filter((d) => !docPrepared(d))
          .map((d) => documentDisplayName(d, tDocs));
        const missingDocs =
          freshNames.length > 0
            ? freshNames
            : err.detailCodes?.includes('document_not_printed') === true
              ? (err.detailMessages ?? [])
              : [];
        setError(
          missingDocs.length > 0
            ? t('wetInkMissing', { items: missingDocs.join(' · ') })
            : t('wetInkNotReady'),
        );
        return;
      }
      setError(
        err.status === 422 && err.fieldPath === 'booked_delivery_at'
            ? t('noSchedule')
            : err.status === 409 && err.errorCode === 'no_plate_available'
              ? t('noPlate')
              : err.status === 409 && err.errorCode === 'no_chaser_available'
                ? t('noChaser')
                : err.status === 409
                  ? t('alreadyBooked')
                  : t('genericError'),
      );
    }
  }

  return (
    <Dialog.Root
      open={deal !== null}
      onOpenChange={(open) => {
        if (!open) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogTitle>
          {t('bookTitle')}
          {dealLabel ? <span className="text-muted-foreground"> — {dealLabel}</span> : null}
        </DialogTitle>
        <div className="mt-3 space-y-3">
          {unprepared.length > 0 ? (
            <p role="status" className="rounded-md bg-warning-bg px-3 py-2 text-sm text-warning-text">
              {t('wetInkWarning', { count: unprepared.length })}
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="book-type">{t('typeCol')}</Label>
              <Select id="book-type" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
                {DispatchType.options.map((dt) => (
                  <option key={dt} value={dt}>
                    {t(DISPATCH_TYPE_KEYS[dt])}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="book-company" optionalText={tCommon('optional')}>
                {t('driverCompany')}
              </Label>
              <Select id="book-company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                <option value="">{t('noCompany')}</option>
                {companies.data?.items
                  .filter((c) => c.active)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="book-when" optionalText={tCommon('optional')}>
              {t('when')}
            </Label>
            <Input id="book-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            <p className="text-xs text-muted-foreground">{t('whenHint')}</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="book-pickup" optionalText={tCommon('optional')}>
              {t('pickupAddress')}
            </Label>
            <Input id="book-pickup" value={pickup} onChange={(e) => setPickup(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="book-delivery" optionalText={tCommon('optional')}>
              {t('deliveryAddress')}
            </Label>
            <Input id="book-delivery" value={delivery} onChange={(e) => setDelivery(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="book-cash" optionalText={tCommon('optional')}>
                {t('cashToCollect')}
              </Label>
              <Input
                id="book-cash"
                inputMode="decimal"
                value={cash}
                aria-invalid={cashInvalid || undefined}
                aria-describedby={cashInvalid ? 'book-cash-error' : undefined}
                className={cashInvalid ? 'border-danger-border' : undefined}
                onChange={(e) => setCash(e.target.value)}
              />
              {cashInvalid ? (
                <p id="book-cash-error" role="alert" className="text-xs text-danger-text">
                  {t('invalidAmount')}
                </p>
              ) : null}
            </div>
            <div className="space-y-1">
              <Label htmlFor="book-notes" optionalText={tCommon('optional')}>
                {t('notes')}
              </Label>
              <Input id="book-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
            </div>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-danger-text">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Dialog.Close
              render={
                <Button type="button" variant="outline">
                  {t('cancel')}
                </Button>
              }
            />
            <Button type="button" disabled={book.isPending || cashInvalid} onClick={() => void handleBook()}>
              {book.isPending ? t('booking') : t('book')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog.Root>
  );
}
