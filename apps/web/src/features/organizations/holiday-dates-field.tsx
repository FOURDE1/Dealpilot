import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Label } from '@dealpilot/ui';
import { addHoliday, removeHoliday } from './holiday-dates.js';

/**
 * F-76 — the holiday list (the producer for `stores.holiday_dates`).
 *
 * A native `type="date"` input plus « Ajouter »; the list renders the
 * literal `YYYY-MM-DD` (what the server stores and what the e2e asserts)
 * beside the localized long form for people. Duplicates are a no-op and the
 * 61st date is refused locally (holiday-dates.ts, in lockstep with the
 * schema's `.max(60)`); a server refusal on `holiday_dates.<i>` lands on the
 * same error line through `serverError`. Read-only is the parent's
 * `<fieldset disabled>` around the whole form (it disables every control in
 * here too), so the field carries no `disabled` prop of its own.
 */
export interface HolidayDatesFieldProps {
  readonly dates: readonly string[];
  readonly onChange: (next: string[]) => void;
  readonly serverError: string | null;
}

export const HOLIDAY_INPUT_ID = 'store-holiday';

export function HolidayDatesField({ dates, onChange, serverError }: HolidayDatesFieldProps) {
  const { t, i18n } = useTranslation('orgs');
  const [draft, setDraft] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  // The literal is a calendar date, not an instant: format it at UTC midnight
  // so the long form never slips a day in a browser west of Greenwich.
  const longDate = (d: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));

  function add() {
    const result = addHoliday(dates, draft);
    if (!result.ok) {
      setLocalError(t(result.reason === 'max' ? 'holidayMax' : 'holidayInvalidDate'));
      return;
    }
    setLocalError(null);
    onChange(result.list);
    setDraft('');
  }

  /**
   * Remove a date without dropping keyboard focus to <body>: the « Retirer »
   * button unmounts with its row on the next render, so focus is moved FIRST
   * — to the next row's button, else the previous row's, else the « Date à
   * ajouter » input (always rendered). Synchronous on purpose: React batches
   * the parent's state until this handler returns, so the sibling rows (keyed
   * by date, hence stable) are still in the DOM when `.focus()` runs.
   */
  function remove(button: HTMLButtonElement, d: string) {
    const li = button.closest('li');
    const sibling = (li?.nextElementSibling ?? li?.previousElementSibling)?.querySelector('button');
    (sibling ?? document.getElementById(HOLIDAY_INPUT_ID))?.focus();
    onChange(removeHoliday(dates, d));
  }

  const error = serverError ?? localError;
  return (
    <fieldset className="min-w-0 space-y-3">
      <legend className="text-[13px] font-medium">{t('holidays')}</legend>
      <p id="store-holidays-hint" className="text-xs text-muted-foreground">
        {t('holidaysHint')}
      </p>
      <div className="space-y-1">
        <Label htmlFor={HOLIDAY_INPUT_ID}>{t('holidayDate')}</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id={HOLIDAY_INPUT_ID}
            type="date"
            className="max-w-xs"
            value={draft}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'store-holidays-error' : 'store-holidays-hint'}
            onChange={(e) => {
              setDraft(e.target.value);
              setLocalError(null);
            }}
            onKeyDown={(e) => {
              // Enter adds the date instead of submitting the whole form.
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button type="button" variant="outline" size="sm" onClick={add}>
            {t('holidayAdd')}
          </Button>
        </div>
        {error ? (
          <p id="store-holidays-error" role="alert" className="text-xs text-danger-text">
            {error}
          </p>
        ) : null}
      </div>
      {dates.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('holidaysEmpty')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {dates.map((d) => (
            <li key={d} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span>
                <time dateTime={d} className="font-mono">
                  {d}
                </time>
                <span className="text-muted-foreground"> — {longDate(d)}</span>
              </span>
              <Button type="button" variant="outline" size="sm" onClick={(e) => remove(e.currentTarget, d)}>
                {t('holidayRemove', { date: d })}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
