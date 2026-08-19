import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../../shared/use-page-title.js';
import {
  Button,
  DataTable,
  Input,
  Label,
  Select,
  type ColumnDef,
} from '@dealpilot/ui';
import { AcquisitionType, type VehicleT } from '@dealpilot/schemas';
import { ApiError } from '../../shared/api/client.js';
import { useOrganizations, useStores } from '../organizations/api.js';
import { formatCents, parseMoneyToCents } from '../deals/money.js';
import { useCreateVehicle, useVehicles } from './api.js';
import {
  ACQUISITION_KEYS,
  LOCATION_STATUS_KEYS,
  VEHICLE_DEAL_STATUS_KEYS,
  vehicleDisplayName,
} from './labels.js';

interface Draft {
  store_id: string;
  stock_number: string;
  year: string;
  make: string;
  model: string;
  vin: string;
  acquisition_type: VehicleT['acquisition_type'];
  acquisition_cost: string;
  transport_cost: string;
  recon_cost: string;
  list_price: string;
}

const INITIAL: Draft = {
  store_id: '',
  stock_number: '',
  year: '',
  make: '',
  model: '',
  vin: '',
  acquisition_type: 'auction',
  acquisition_cost: '',
  transport_cost: '',
  recon_cost: '',
  list_price: '',
};

export function InventoryPage() {
  const { t, i18n } = useTranslation('inventory');
  const { t: tCommon } = useTranslation('common');
  usePageTitle(t('title'));
  const orgs = useOrganizations();
  const multiOrg = (orgs.data?.items.length ?? 0) > 1;
  const [orgFilter, setOrgFilter] = useState('');
  const orgId = multiOrg ? orgFilter || orgs.data?.items[0]?.id : orgs.data?.items[0]?.id;
  const vehicles = useVehicles(multiOrg ? orgId : undefined, { enabled: !orgs.isPending });
  const stores = useStores(orgId ?? '');
  const createVehicle = useCreateVehicle();
  const [draft, setDraft] = useState<Draft>(INITIAL);
  const [error, setError] = useState<string | null>(null);
  const yearInvalid = draft.year.trim() !== '' && !/^\d{4}$/.test(draft.year.trim());
  const moneyInvalid = (raw: string) => raw.trim() !== '' && parseMoneyToCents(raw) === null;

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const storeId = draft.store_id || stores.data?.items[0]?.id;
    const year = /^\d{4}$/.test(draft.year.trim()) ? Number(draft.year.trim()) : null;
    const acq = draft.acquisition_cost.trim() === '' ? 0 : parseMoneyToCents(draft.acquisition_cost);
    const transport = draft.transport_cost.trim() === '' ? 0 : parseMoneyToCents(draft.transport_cost);
    const recon = draft.recon_cost.trim() === '' ? 0 : parseMoneyToCents(draft.recon_cost);
    const list = draft.list_price.trim() === '' ? undefined : parseMoneyToCents(draft.list_price);
    if (!orgId || !storeId || year === null || acq === null || transport === null || recon === null || list === null) {
      setError(t('checkFields'));
      return;
    }
    try {
      await createVehicle.mutateAsync({
        organization_id: orgId,
        store_id: storeId,
        stock_number: draft.stock_number.trim(),
        year,
        make: draft.make.trim(),
        model: draft.model.trim(),
        ...(draft.vin.trim() === '' ? {} : { vin: draft.vin.trim() }),
        vehicle_type: 'used',
        acquisition_type: draft.acquisition_type,
        location_status: 'on_lot',
        acquisition_cost_cents: acq,
        transport_cost_cents: transport,
        recon_cost_cents: recon,
        ...(list === undefined ? {} : { list_price_cents: list }),
      });
      setDraft(INITIAL);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setError(
        err.status === 409
          ? err.fieldPath === 'vin'
            ? t('vinInUse')
            : t('stockInUse')
          : err.status === 422 && err.fieldPath === 'vin'
            ? t('invalidVin')
            : t('genericError'),
      );
    }
  }

  const columns = useMemo<ColumnDef<VehicleT, unknown>[]>(
    () => [
      {
        accessorKey: 'stock_number',
        header: t('stockNo'),
        cell: ({ row }) => (
          <Link to={`/inventory/${row.original.id}`} className="font-mono text-[13px] text-primary underline-offset-4 hover:underline">
            {row.original.stock_number}
          </Link>
        ),
      },
      { id: 'vehicle', header: t('vehicle'), cell: ({ row }) => vehicleDisplayName(row.original) },
      {
        accessorKey: 'list_price_cents',
        header: t('listPrice'),
        cell: ({ row }) =>
          row.original.list_price_cents === null || row.original.list_price_cents === undefined ? '—' : (
            <span className="font-mono tabular-nums">{formatCents(row.original.list_price_cents, i18n.language)}</span>
          ),
      },
      {
        accessorKey: 'total_cost_cents',
        header: t('totalCost'),
        // FR-TEN-006: masked = absent — show a dash, never a fake zero.
        cell: ({ row }) =>
          row.original.total_cost_cents === undefined ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className="font-mono tabular-nums">{formatCents(row.original.total_cost_cents, i18n.language)}</span>
          ),
      },
      {
        accessorKey: 'location_status',
        header: t('locationCol'),
        cell: ({ row }) => t(LOCATION_STATUS_KEYS[row.original.location_status]),
      },
      {
        accessorKey: 'deal_status',
        header: t('dealStatusCol'),
        cell: ({ row }) => t(VEHICLE_DEAL_STATUS_KEYS[row.original.deal_status]),
      },
    ],
    [t, i18n.language],
  );

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        {multiOrg ? (
          <div className="mt-3 max-w-xs space-y-1">
            <Label htmlFor="inv-org">{t('orgScope')}</Label>
            <Select
              id="inv-org"
              value={orgId ?? ''}
              onChange={(e) => {
                setOrgFilter(e.target.value);
                set('store_id', ''); // stores belong to the org — never submit a stale one
              }}
            >
              {orgs.data?.items.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </header>

      <form
        noValidate
        onSubmit={(e) => void handleAdd(e)}
        className="space-y-3 rounded-lg border border-border bg-card p-4"
        aria-labelledby="inv-add-title"
      >
        <h2 id="inv-add-title" className="text-[15px] font-semibold">
          {t('addTitle')}
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="inv-store">{t('store')}</Label>
            <Select
              id="inv-store"
              value={draft.store_id || (stores.data?.items[0]?.id ?? '')}
              onChange={(e) => set('store_id', e.target.value)}
            >
              {stores.data?.items.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="inv-stock">{t('stockNo')}</Label>
            <Input id="inv-stock" value={draft.stock_number} onChange={(e) => set('stock_number', e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="inv-year">{t('year')}</Label>
            <Input
              id="inv-year"
              inputMode="numeric"
              value={draft.year}
              aria-invalid={yearInvalid || undefined}
              aria-describedby={yearInvalid ? 'inv-year-error' : undefined}
              className={yearInvalid ? 'border-danger-border' : undefined}
              onChange={(e) => set('year', e.target.value)}
              required
            />
            {yearInvalid ? (
              <p id="inv-year-error" role="alert" className="text-xs text-danger-text">
                {t('invalidYear')}
              </p>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="inv-make">{t('make')}</Label>
            <Input id="inv-make" value={draft.make} onChange={(e) => set('make', e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="inv-model">{t('model')}</Label>
            <Input id="inv-model" value={draft.model} onChange={(e) => set('model', e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="inv-vin" optionalText={tCommon('optional')}>{t('vin')}</Label>
            <Input id="inv-vin" className="font-mono" value={draft.vin} onChange={(e) => set('vin', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="inv-acq-type">{t('acquisitionType')}</Label>
            <Select
              id="inv-acq-type"
              value={draft.acquisition_type}
              onChange={(e) => set('acquisition_type', e.target.value as Draft['acquisition_type'])}
            >
              {AcquisitionType.options.map((a) => (
                <option key={a} value={a}>
                  {t(ACQUISITION_KEYS[a])}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="inv-acq-cost" optionalText={tCommon('optional')}>{t('acquisitionCost')}</Label>
            <Input
              id="inv-acq-cost"
              inputMode="decimal"
              value={draft.acquisition_cost}
              aria-invalid={moneyInvalid(draft.acquisition_cost) || undefined}
              aria-describedby={moneyInvalid(draft.acquisition_cost) ? 'inv-acq-cost-error' : undefined}
              className={moneyInvalid(draft.acquisition_cost) ? 'border-danger-border' : undefined}
              onChange={(e) => set('acquisition_cost', e.target.value)}
            />
            {moneyInvalid(draft.acquisition_cost) ? (
              <p id="inv-acq-cost-error" role="alert" className="text-xs text-danger-text">
                {t('invalidAmount')}
              </p>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="inv-transport" optionalText={tCommon('optional')}>{t('transportCost')}</Label>
            <Input
              id="inv-transport"
              inputMode="decimal"
              value={draft.transport_cost}
              aria-invalid={moneyInvalid(draft.transport_cost) || undefined}
              aria-describedby={moneyInvalid(draft.transport_cost) ? 'inv-transport-error' : undefined}
              className={moneyInvalid(draft.transport_cost) ? 'border-danger-border' : undefined}
              onChange={(e) => set('transport_cost', e.target.value)}
            />
            {moneyInvalid(draft.transport_cost) ? (
              <p id="inv-transport-error" role="alert" className="text-xs text-danger-text">
                {t('invalidAmount')}
              </p>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="inv-recon" optionalText={tCommon('optional')}>{t('reconCost')}</Label>
            <Input
              id="inv-recon"
              inputMode="decimal"
              value={draft.recon_cost}
              aria-invalid={moneyInvalid(draft.recon_cost) || undefined}
              aria-describedby={moneyInvalid(draft.recon_cost) ? 'inv-recon-error' : undefined}
              className={moneyInvalid(draft.recon_cost) ? 'border-danger-border' : undefined}
              onChange={(e) => set('recon_cost', e.target.value)}
            />
            {moneyInvalid(draft.recon_cost) ? (
              <p id="inv-recon-error" role="alert" className="text-xs text-danger-text">
                {t('invalidAmount')}
              </p>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="inv-list" optionalText={tCommon('optional')}>{t('listPrice')}</Label>
            <Input
              id="inv-list"
              inputMode="decimal"
              value={draft.list_price}
              aria-invalid={moneyInvalid(draft.list_price) || undefined}
              aria-describedby={moneyInvalid(draft.list_price) ? 'inv-list-error' : undefined}
              className={moneyInvalid(draft.list_price) ? 'border-danger-border' : undefined}
              onChange={(e) => set('list_price', e.target.value)}
            />
            {moneyInvalid(draft.list_price) ? (
              <p id="inv-list-error" role="alert" className="text-xs text-danger-text">
                {t('invalidAmount')}
              </p>
            ) : null}
          </div>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-danger-text">
            {error}
          </p>
        ) : null}
        <Button
          type="submit"
          disabled={
            createVehicle.isPending ||
            draft.stock_number.trim() === '' ||
            draft.make.trim() === '' ||
            draft.model.trim() === '' ||
            // No store resolved yet — either the stores query is still in
            // flight or the org has no stores. Submitting would fail with
            // "fix the invalid fields" when nothing the user typed is wrong;
            // a button that cannot succeed must not be clickable. Found by
            // f07 clicking faster than the stores request on a busy machine.
            (draft.store_id === '' && stores.data?.items[0]?.id === undefined)
          }
        >
          {createVehicle.isPending ? t('adding') : t('add')}
        </Button>
      </form>

      {vehicles.data?.truncated ? (
        <p className="text-sm text-muted-foreground">{t('invTruncated')}</p>
      ) : null}
      <DataTable
        columns={columns}
        data={vehicles.data?.items}
        isPending={orgs.isPending || vehicles.isPending}
        isError={vehicles.isError}
        loadingMessage={t('loading')}
        errorMessage={t('loadError')}
        emptyMessage={t('empty')}
      />
    </div>
  );
}
