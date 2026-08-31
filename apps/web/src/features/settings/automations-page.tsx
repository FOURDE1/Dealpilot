import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Label, Select } from '@dealpilot/ui';
import { usePageTitle } from '../../shared/use-page-title.js';
import { BackLink } from '../../shared/ui/back-link.js';
import { ApiError } from '../../shared/api/client.js';
import { can, usePermissionsMine } from '../../shared/permissions.js';
import { useOrganizations } from '../organizations/api.js';
import { useCommsConfig, useUpdateCommsConfig } from '../compliance/api.js';
import { CAP_RANGES, COMMS_DEFAULTS, capInvalid, commsDiff, fromRow, validateWindow, type CommsDraft } from './comms-window.js';

/**
 * F-76 (R8) — /settings/automations: the organization's texting window,
 * first-touch exemption and the two caps, over the EXISTING
 * GET/PUT /organizations/:id/comms-config. One row per organization: the
 * table supports per-store rows but no route writes one, so the page says
 * « S'applique à toutes les succursales » and offers nothing per store.
 *
 * `null` from GET means no row — the platform defaults are shown and said
 * out loud. The PUT carries only the changed keys (commsDiff); the client
 * mirrors the ceiling, the order and the integer ranges so save is disabled
 * with a message under the field, and the server's 422s land on the same
 * fields: `window_too_wide` (always reported on start) and `invalid_window`
 * (on end). Read-only without `organization:update`: controls disabled, no
 * save button — the server refuses anyway (403 → the `forbidden` copy).
 */
export function AutomationsPage() {
  const { t } = useTranslation('settings');
  usePageTitle(t('sec_automations'));
  const orgs = useOrganizations();
  const noOrg = orgs.isSuccess && orgs.data.items.length === 0;
  const multiOrg = (orgs.data?.items.length ?? 0) > 1;
  const [orgFilter, setOrgFilter] = useState('');
  const orgId = multiOrg ? orgFilter || orgs.data?.items[0]?.id : orgs.data?.items[0]?.id;
  const mine = usePermissionsMine(multiOrg ? orgId : undefined, { enabled: !orgs.isPending && !noOrg });
  const readOnly = mine.isSuccess && !can(mine.data, 'organization:update');
  const config = useCommsConfig(orgId, { enabled: !orgs.isPending && !noOrg });
  const update = useUpdateCommsConfig(orgId);

  const [draft, setDraft] = useState<CommsDraft>(COMMS_DEFAULTS);
  // What the form opened with (or last saved) — the diff's other side.
  const baseline = useRef<CommsDraft>(COMMS_DEFAULTS);
  const initializedFor = useRef<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<{ start?: string; end?: string }>({});
  const alertRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    // Populate ONCE per organization — a background refetch must never
    // clobber edits; a change of organization starts over.
    if (config.isSuccess && orgId && initializedFor.current !== orgId) {
      initializedFor.current = orgId;
      const row = fromRow(config.data);
      baseline.current = row;
      setDraft(row);
      setSaved(false);
      setTopError(null);
      setServerErrors({});
    }
  }, [config.isSuccess, config.data, orgId]);

  useEffect(() => {
    if (topError) alertRef.current?.focus();
  }, [topError]);

  const set = (patch: Partial<CommsDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setSaved(false);
    setTopError(null);
    if ('start' in patch || 'end' in patch) setServerErrors({});
  };

  const windowErrors = validateWindow(draft.start, draft.end);
  const dailyInvalid = capInvalid(draft.dailyCap, CAP_RANGES.daily);
  const turnInvalid = capInvalid(draft.turnCap, CAP_RANGES.turn);
  const patch = commsDiff(baseline.current, draft);
  const clientInvalid = windowErrors.start !== null || windowErrors.end !== null || dailyInvalid || turnInvalid;
  const canSave = !clientInvalid && Object.keys(patch).length > 0 && !update.isPending;

  const windowMessage = (error: 'format' | 'tooWide' | 'inverted' | null): string | null =>
    error === 'format' ? t('windowFormat') : error === 'tooWide' ? t('windowTooWide') : error === 'inverted' ? t('windowInverted') : null;
  const startError = serverErrors.start ?? windowMessage(windowErrors.start);
  const endError = serverErrors.end ?? windowMessage(windowErrors.end);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    setTopError(null);
    setServerErrors({});
    try {
      const row = await update.mutateAsync(patch);
      const next = fromRow(row);
      baseline.current = next;
      setDraft(next);
      setSaved(true);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      const codes = new Set([err.errorCode, ...(err.detailCodes ?? [])]);
      if (codes.has('window_too_wide')) setServerErrors({ start: t('windowTooWide') });
      else if (codes.has('invalid_window')) setServerErrors({ end: t('windowInverted') });
      else if (err.status === 403) setTopError(t('forbidden'));
      else setTopError(t('genericError'));
    }
  }

  const disabled = readOnly || config.isPending;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <BackLink to="/settings">{t('title')}</BackLink>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('sec_automations')}</h1>
        <p className="text-sm text-muted-foreground">{t('automationsSubtitle')}</p>
      </header>

      {multiOrg ? (
        <div className="max-w-xs space-y-1">
          <Label htmlFor="comms-org">{t('orgScope')}</Label>
          <Select id="comms-org" value={orgId ?? ''} onChange={(e) => setOrgFilter(e.target.value)}>
            {orgs.data?.items.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </div>
      ) : null}

      {noOrg ? (
        <p className="text-sm text-muted-foreground">{t('noOrg')}</p>
      ) : config.isError ? (
        <p role="alert" className="text-sm text-danger-text">
          {t('loadError')}
        </p>
      ) : (
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 rounded-lg border border-border bg-card p-6" noValidate>
          <p className="text-sm text-muted-foreground">{t('appliesToAll')}</p>
          {config.isSuccess && config.data === null ? (
            <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm text-foreground">
              {t('defaultsNotice')}
            </p>
          ) : null}
          {readOnly ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t('readOnly')}
            </p>
          ) : null}
          <fieldset disabled={disabled} className="min-w-0 space-y-4" aria-busy={config.isPending || undefined}>
            <div className="space-y-1">
              <Label htmlFor="comms-start">{t('windowStart')}</Label>
              <Input
                id="comms-start"
                type="time"
                step={60}
                value={draft.start}
                aria-invalid={startError ? true : undefined}
                aria-describedby={startError ? 'comms-start-error comms-window-hint' : 'comms-window-hint'}
                className={startError ? 'border-danger-border' : undefined}
                onChange={(e) => set({ start: e.target.value.slice(0, 5) })}
              />
              {startError ? (
                <p id="comms-start-error" role="alert" className="text-xs text-danger-text">
                  {startError}
                </p>
              ) : null}
            </div>
            <div className="space-y-1">
              <Label htmlFor="comms-end">{t('windowEnd')}</Label>
              <Input
                id="comms-end"
                type="time"
                step={60}
                value={draft.end}
                aria-invalid={endError ? true : undefined}
                aria-describedby={endError ? 'comms-end-error comms-window-hint' : 'comms-window-hint'}
                className={endError ? 'border-danger-border' : undefined}
                onChange={(e) => set({ end: e.target.value.slice(0, 5) })}
              />
              {endError ? (
                <p id="comms-end-error" role="alert" className="text-xs text-danger-text">
                  {endError}
                </p>
              ) : null}
              <p id="comms-window-hint" className="text-xs text-muted-foreground">
                {t('windowHint')}
              </p>
            </div>
            <div className="space-y-1">
              <div className="flex items-start gap-2">
                <input
                  id="comms-first-touch"
                  type="checkbox"
                  className="mt-1 size-4 accent-primary-text"
                  checked={draft.firstTouchExempt}
                  aria-describedby="comms-first-touch-hint"
                  onChange={(e) => set({ firstTouchExempt: e.target.checked })}
                />
                <Label htmlFor="comms-first-touch" className="text-sm">
                  {t('firstTouchExempt')}
                </Label>
              </div>
              <p id="comms-first-touch-hint" className="text-xs text-muted-foreground">
                {t('firstTouchHint')}
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="comms-daily-cap">{t('dailyCap')}</Label>
              <Input
                id="comms-daily-cap"
                type="number"
                inputMode="numeric"
                min={CAP_RANGES.daily.min}
                max={CAP_RANGES.daily.max}
                step={1}
                value={draft.dailyCap}
                aria-invalid={dailyInvalid ? true : undefined}
                aria-describedby={dailyInvalid ? 'comms-daily-cap-error' : 'comms-daily-cap-hint'}
                className={dailyInvalid ? 'border-danger-border' : undefined}
                onChange={(e) => set({ dailyCap: e.target.value })}
              />
              {dailyInvalid ? (
                <p id="comms-daily-cap-error" role="alert" className="text-xs text-danger-text">
                  {t('capRange')}
                </p>
              ) : (
                <p id="comms-daily-cap-hint" className="text-xs text-muted-foreground">
                  {t('dailyCapHint')}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="comms-turn-cap">{t('turnCap')}</Label>
              <Input
                id="comms-turn-cap"
                type="number"
                inputMode="numeric"
                min={CAP_RANGES.turn.min}
                max={CAP_RANGES.turn.max}
                step={1}
                value={draft.turnCap}
                aria-invalid={turnInvalid ? true : undefined}
                aria-describedby={turnInvalid ? 'comms-turn-cap-error' : 'comms-turn-cap-hint'}
                className={turnInvalid ? 'border-danger-border' : undefined}
                onChange={(e) => set({ turnCap: e.target.value })}
              />
              {turnInvalid ? (
                <p id="comms-turn-cap-error" role="alert" className="text-xs text-danger-text">
                  {t('capRange')}
                </p>
              ) : (
                <p id="comms-turn-cap-hint" className="text-xs text-muted-foreground">
                  {t('turnCapHint')}
                </p>
              )}
            </div>
          </fieldset>
          {topError ? (
            <p ref={alertRef} tabIndex={-1} role="alert" className="rounded-md border border-danger-border px-3 py-2 text-sm text-danger-text">
              {topError}
            </p>
          ) : null}
          {saved ? (
            <p role="status" className="text-sm font-medium text-success-text">
              {t('saved')}
            </p>
          ) : null}
          {readOnly ? null : (
            <Button type="submit" disabled={!canSave}>
              {update.isPending ? t('saving') : t('save')}
            </Button>
          )}
        </form>
      )}
    </div>
  );
}
