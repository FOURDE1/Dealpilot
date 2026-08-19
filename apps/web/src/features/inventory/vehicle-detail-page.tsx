import { useState } from 'react';
import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../../shared/use-page-title.js';
import { BackLink } from '../../shared/ui/back-link.js';
import { Button, Input, Label, Select } from '@dealpilot/ui';
import { LocationStatus, VehicleDealStatus, type VehicleT } from '@dealpilot/schemas';
import { ApiError } from '../../shared/api/client.js';
import { formatCents, parseMoneyToCents } from '../deals/money.js';
import { useUpdateVehicle, useVehicle } from './api.js';
import {
  ACQUISITION_KEYS,
  LOCATION_STATUS_KEYS,
  VEHICLE_DEAL_STATUS_KEYS,
  VEHICLE_TYPE_KEYS,
  vehicleDisplayName,
} from './labels.js';

/** Status moves + the money facts that change after purchase (recon, list price). */
export function VehicleDetailPage() {
  const { t, i18n } = useTranslation('inventory');
  const { vehicleId = '' } = useParams();
  const vehicle = useVehicle(vehicleId);
  const update = useUpdateVehicle(vehicleId);
  usePageTitle(vehicle.data ? vehicleDisplayName(vehicle.data) : undefined);
  const [reconDraft, setReconDraft] = useState<string | null>(null);
  const [listDraft, setListDraft] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<'saved' | 'error' | null>(null);

  async function patch(body: Parameters<typeof update.mutateAsync>[0]): Promise<boolean> {
    setFeedback(null);
    try {
      await update.mutateAsync(body);
      setFeedback('saved');
      return true;
    } catch (err) {
      setFeedback('error');
      if (!(err instanceof ApiError)) throw err;
      return false;
    }
  }

  if (vehicle.isPending)
    return (
      <p className="text-sm text-muted-foreground" aria-busy="true">
        {t('loading')}
      </p>
    );
  if (vehicle.isError || !vehicle.data)
    return (
      <p role="alert" className="text-sm text-danger-text">
        {t('loadError')}
      </p>
    );

  const v: VehicleT = vehicle.data;
  const locale = i18n.language;
  // FR-TEN-006: masked viewers have no cost numbers to edit — the drafts (and
  // the whole cost section below) simply do not exist for them.
  const recon = reconDraft ?? (v.recon_cost_cents === undefined ? '' : (v.recon_cost_cents / 100).toFixed(2));
  const list = listDraft ?? (v.list_price_cents === null || v.list_price_cents === undefined ? '' : (v.list_price_cents / 100).toFixed(2));
  const reconInvalid = recon.trim() !== '' && parseMoneyToCents(recon) === null;
  const listInvalid = list.trim() !== '' && parseMoneyToCents(list) === null;

  return (
    <div className="space-y-6">
      <BackLink to="/inventory">{t('back')}</BackLink>
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-2xl font-semibold">{vehicleDisplayName(v)}</h1>
        <span className="font-mono text-sm text-muted-foreground">{v.stock_number}</span>
        {v.vin ? <span className="font-mono text-sm text-muted-foreground">{v.vin}</span> : null}
      </header>

      <div className="grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
        <dl className="space-y-2 rounded-lg border border-border bg-card p-4 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{t('type')}</dt>
            <dd>{t(VEHICLE_TYPE_KEYS[v.vehicle_type])}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{t('acquisitionType')}</dt>
            <dd>{t(ACQUISITION_KEYS[v.acquisition_type])}</dd>
          </div>
          {/* FR-TEN-006: outside your store the cost build-up is not
              your number to see — the section is absent, not zeroed. */}
          {v.total_cost_cents === undefined ? null : (<>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{t('acquisitionCost')}</dt>
            <dd className="font-mono tabular-nums">{v.acquisition_cost_cents === undefined ? '—' : formatCents(v.acquisition_cost_cents, locale)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{t('transportCost')}</dt>
            <dd className="font-mono tabular-nums">{v.transport_cost_cents === undefined ? '—' : formatCents(v.transport_cost_cents, locale)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{t('reconCost')}</dt>
            <dd className="font-mono tabular-nums">{v.recon_cost_cents === undefined ? '—' : formatCents(v.recon_cost_cents, locale)}</dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-border pt-2 font-semibold">
            <dt>{t('totalCost')}</dt>
            <dd className="font-mono tabular-nums">{v.total_cost_cents === undefined ? '—' : formatCents(v.total_cost_cents, locale)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{t('listPrice')}</dt>
            <dd className="font-mono tabular-nums">
              {v.list_price_cents === null || v.list_price_cents === undefined ? '—' : formatCents(v.list_price_cents, locale)}
            </dd>
          </div>
          </>)}
        </dl>

        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="space-y-1">
            <Label htmlFor="veh-location">{t('locationCol')}</Label>
            <Select
              id="veh-location"
              value={v.location_status}
              disabled={update.isPending}
              onChange={(e) => void patch({ location_status: e.target.value as VehicleT['location_status'] })}
            >
              {LocationStatus.options.map((l) => (
                <option key={l} value={l}>
                  {t(LOCATION_STATUS_KEYS[l])}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="veh-dealstatus">{t('dealStatusCol')}</Label>
            <Select
              id="veh-dealstatus"
              value={v.deal_status}
              disabled={update.isPending}
              onChange={(e) => void patch({ deal_status: e.target.value as VehicleT['deal_status'] })}
            >
              {VehicleDealStatus.options.map((d) => (
                <option key={d} value={d}>
                  {t(VEHICLE_DEAL_STATUS_KEYS[d])}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="veh-recon">{t('reconCost')}</Label>
            <Input
              id="veh-recon"
              inputMode="decimal"
              value={recon}
              aria-invalid={reconInvalid || undefined}
              aria-describedby={reconInvalid ? 'veh-recon-error' : undefined}
              className={reconInvalid ? 'border-danger-border' : undefined}
              onChange={(e) => setReconDraft(e.target.value)}
            />
            {reconInvalid ? (
              <p id="veh-recon-error" role="alert" className="text-xs text-danger-text">
                {t('invalidAmount')}
              </p>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="veh-list">{t('listPrice')}</Label>
            <Input
              id="veh-list"
              inputMode="decimal"
              value={list}
              aria-invalid={listInvalid || undefined}
              aria-describedby={listInvalid ? 'veh-list-error' : undefined}
              className={listInvalid ? 'border-danger-border' : undefined}
              onChange={(e) => setListDraft(e.target.value)}
            />
            {listInvalid ? (
              <p id="veh-list-error" role="alert" className="text-xs text-danger-text">
                {t('invalidAmount')}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            disabled={update.isPending || reconInvalid || listInvalid}
            onClick={() => {
              const reconCents = recon.trim() === '' ? 0 : parseMoneyToCents(recon);
              const listCents = list.trim() === '' ? null : parseMoneyToCents(list);
              if (reconCents === null || (list.trim() !== '' && listCents === null)) return;
              void patch({ recon_cost_cents: reconCents, list_price_cents: listCents }).then(
                (ok) => {
                  // Typed values must survive a failed save.
                  if (ok) {
                    setReconDraft(null);
                    setListDraft(null);
                  }
                },
              );
            }}
          >
            {update.isPending ? t('saving') : t('save')}
          </Button>
          {feedback === 'saved' ? (
            <p role="status" className="text-sm font-medium text-success-text">
              {t('saved')}
            </p>
          ) : null}
          {feedback === 'error' ? (
            <p role="alert" className="text-sm text-danger-text">
              {t('genericError')}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
