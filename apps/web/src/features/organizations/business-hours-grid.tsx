import { useTranslation } from 'react-i18next';
import { Button, Input, Label } from '@dealpilot/ui';
import { DAY_KEYS, rowError, type DayKey, type HoursAction, type HoursDraft } from './hours-grid.js';

/**
 * F-76 — the opening-hours grid (the producer for `stores.business_hours`).
 *
 * Seven rows, each a checkbox « Ouvert — lundi » and two `type="time"`
 * inputs « Ouverture — lundi » / « Fermeture — lundi »; every label is
 * visible and unique, so `getByLabel` and a screen reader read the same
 * thing. A closed day keeps its times greyed and is OMITTED from the payload
 * (hours-grid.ts). The row's error line carries either the client mirror of
 * the server rule (both times, close after open) or the server's own answer
 * (`business_hours.<day>*` mapped by form-error.ts); save is disabled by the
 * parent while any client error stands. Read-only is the parent's
 * `<fieldset disabled>` around the whole form — a disabled fieldset disables
 * every control inside it, this one included — so the grid carries no
 * `disabled` prop of its own; a closed day's time inputs are the only
 * controls it disables itself.
 */
export interface BusinessHoursGridProps {
  readonly draft: HoursDraft;
  readonly dispatch: (action: HoursAction) => void;
  /** Server refusals per row, set by the parent after a 422. */
  readonly serverErrors: Partial<Record<DayKey, string>>;
}

export const hoursRowId = (day: DayKey, part: 'open' | 'from' | 'to' | 'error') => `store-hours-${day}-${part}`;

export function BusinessHoursGrid({ draft, dispatch, serverErrors }: BusinessHoursGridProps) {
  const { t } = useTranslation('orgs');
  return (
    // The hint describes the GRID, so it is the fieldset's accessible
    // description (announced on entering the group) rather than a sentence
    // repeated by fourteen time inputs; a row's own error line stays on its
    // two inputs below.
    <fieldset className="min-w-0 space-y-3" aria-describedby="store-hours-hint">
      <legend className="text-[13px] font-medium">{t('hoursLegend')}</legend>
      <p id="store-hours-hint" className="text-xs text-muted-foreground">
        {t('hoursHint')}
      </p>
      {DAY_KEYS.map((day) => {
        const row = draft[day];
        const dayName = t(`day_${day}`);
        const clientError = rowError(row);
        const message =
          serverErrors[day] ??
          (clientError === 'order' ? t('hoursOrderError') : clientError === 'missing' ? t('hoursMissingError') : null);
        const errorId = hoursRowId(day, 'error');
        const timeProps = {
          type: 'time' as const,
          step: 60,
          disabled: !row.open,
          'aria-invalid': message ? true : undefined,
          'aria-describedby': message ? errorId : undefined,
          className: message ? 'border-danger-border' : undefined,
        };
        return (
          <div key={day} role="group" aria-label={dayName} className="space-y-2 rounded-md border border-border p-3">
            <div className="flex items-center gap-2">
              <input
                id={hoursRowId(day, 'open')}
                type="checkbox"
                className="size-4 accent-primary-text"
                checked={row.open}
                onChange={() => dispatch({ type: 'toggle', day })}
              />
              <Label htmlFor={hoursRowId(day, 'open')} className="text-sm">
                {t('dayOpen', { day: dayName })}
              </Label>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor={hoursRowId(day, 'from')}>{t('dayFrom', { day: dayName })}</Label>
                <Input
                  id={hoursRowId(day, 'from')}
                  value={row.from}
                  onChange={(e) => dispatch({ type: 'time', day, edge: 'from', value: e.target.value })}
                  {...timeProps}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={hoursRowId(day, 'to')}>{t('dayTo', { day: dayName })}</Label>
                <Input
                  id={hoursRowId(day, 'to')}
                  value={row.to}
                  onChange={(e) => dispatch({ type: 'time', day, edge: 'to', value: e.target.value })}
                  {...timeProps}
                />
              </div>
            </div>
            {message ? (
              <p id={errorId} role="alert" className="text-xs text-danger-text">
                {message}
              </p>
            ) : null}
          </div>
        );
      })}
      <Button type="button" variant="outline" size="sm" onClick={() => dispatch({ type: 'copyMondayToWeekdays' })}>
        {t('copyMonday')}
      </Button>
    </fieldset>
  );
}
