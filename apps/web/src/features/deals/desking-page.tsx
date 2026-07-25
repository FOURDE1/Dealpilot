import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Input, Label, Select } from '@dealpilot/ui';
import { CalculateDealInput, ProvinceCA, type CalculateDealInputT } from '@dealpilot/schemas';
import { ApiError } from '../../shared/api/client.js';
import { useLead } from '../leads/api.js';
import { useVehicles } from '../inventory/api.js';
import { activeMembers, useMembers } from '../team/api.js';
import { vehicleDisplayName } from '../inventory/labels.js';
import { leadDisplayName } from '../leads/labels.js';
import { useCalculateDeal, useCreateDeal } from './api.js';
import { DEAL_TYPE_KEYS, PROVINCE_KEYS } from './labels.js';

/** Harmonized-tax provinces — mirrors the engine's tax tables (packages/core). */
const HST_PROVINCES = new Set<CalculateDealInputT['province']>(['ON', 'NB', 'NL', 'NS', 'PE']);
import { formatCents, parseMoneyToCents, parsePctToBps } from './money.js';


/** Raw worksheet text state — parsed to cents/bps on every change. */
interface Draft {
  province: CalculateDealInputT['province'];
  deal_type: CalculateDealInputT['deal_type'];
  sale_price: string;
  msrp: string;
  residual: string;
  vehicle_cost: string;
  cash_down: string;
  trade_allowance: string;
  trade_acv: string;
  trade_lien: string;
  rebate: string;
  fees: string;
  fees_taxable: boolean;
  fi_price: string;
  fi_cost: string;
  rate: string;
  term: string;
  tax_exempt: boolean;
}

const INITIAL: Draft = {
  province: 'QC',
  deal_type: 'finance',
  sale_price: '',
  msrp: '',
  residual: '55',
  vehicle_cost: '',
  cash_down: '',
  trade_allowance: '',
  trade_acv: '',
  trade_lien: '',
  rebate: '',
  fees: '',
  fees_taxable: false,
  fi_price: '',
  fi_cost: '',
  rate: '',
  term: '60',
  tax_exempt: false,
};

/** '' means 0 on the worksheet; garbage means "don't calculate". */
function centsOrZero(raw: string): number | null {
  return raw.trim() === '' ? 0 : parseMoneyToCents(raw);
}

function draftToInputs(d: Draft): CalculateDealInputT | null {
  const sale = parseMoneyToCents(d.sale_price);
  if (sale === null) return null;
  const term = /^\d+$/.test(d.term.trim()) ? Number(d.term.trim()) : null;
  const msrp = d.msrp.trim() === '' ? undefined : parseMoneyToCents(d.msrp);
  if (msrp === null) return null;
  // Residual only matters (and only renders) for a lease — garbage left in the
  // field must never block a finance or cash worksheet.
  let residual = 55;
  if (d.deal_type === 'lease') {
    const parsed = /^\d+$/.test(d.residual.trim()) ? Number(d.residual.trim()) : null;
    if (parsed === null || parsed > 100) return null;
    residual = parsed;
  }
  const fields = {
    vehicle_cost_cents: centsOrZero(d.vehicle_cost),
    cash_down_cents: centsOrZero(d.cash_down),
    trade_allowance_cents: centsOrZero(d.trade_allowance),
    trade_acv_cents: centsOrZero(d.trade_acv),
    trade_lien_cents: centsOrZero(d.trade_lien),
    rebate_cents: centsOrZero(d.rebate),
    fees_cents: centsOrZero(d.fees),
    fi_price_cents: centsOrZero(d.fi_price),
    fi_cost_cents: centsOrZero(d.fi_cost),
    interest_rate_bps: d.rate.trim() === '' ? 0 : parsePctToBps(d.rate),
  };
  if (term === null || Object.values(fields).some((v) => v === null)) return null;
  const parsed = CalculateDealInput.safeParse({
    province: d.province,
    deal_type: d.deal_type,
    sale_price_cents: sale,
    ...(msrp === undefined ? {} : { msrp_cents: msrp }),
    ...(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v as number])) as Record<
      string,
      number
    >),
    fees_taxable: d.fees_taxable,
    residual_percent: residual,
    term_months: term,
    tax_exempt: d.tax_exempt,
  });
  return parsed.success ? parsed.data : null;
}

function MoneyField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const { t } = useTranslation('deals');
  const invalid = value.trim() !== '' && parseMoneyToCents(value) === null;
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid || undefined}
        className={invalid ? 'border-danger-border' : undefined}
      />
      {invalid ? (
        <p role="alert" className="text-xs text-danger-text">
          {t('invalidAmount')}
        </p>
      ) : null}
    </div>
  );
}

function OutputRow({ label, cents, locale, emphasis }: { label: string; cents: number; locale: string; emphasis?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${emphasis ? 'text-base font-semibold' : 'text-sm'}`}>
      <span className={emphasis ? '' : 'text-muted-foreground'}>{label}</span>
      <span className="font-mono tabular-nums">{formatCents(cents, locale)}</span>
    </div>
  );
}

export function DeskingPage() {
  const { t, i18n } = useTranslation('deals');
  const { leadId = '' } = useParams();
  const navigate = useNavigate();
  const lead = useLead(leadId);
  const vehicles = useVehicles(lead.data?.organization_id, {
    enabled: lead.isSuccess,
    storeId: lead.data?.store_id,
    dealStatus: 'available',
  });
  const [vehicleId, setVehicleId] = useState('');
  const members = useMembers(lead.data?.organization_id, { enabled: lead.isSuccess });
  const sellers = activeMembers(members.data?.items);
  const [soldBy, setSoldBy] = useState('');
  const [fiReserve, setFiReserve] = useState('');
  // Provenance of the sale price: only an auto-filled (never user-typed) price
  // may be replaced or cleared when the picked car changes.
  const [prefilledPrice, setPrefilledPrice] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(INITIAL);
  const [debounced, setDebounced] = useState<CalculateDealInputT | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const createDeal = useCreateDeal();
  const locale = i18n.language;

  const inputs = useMemo(() => draftToInputs(draft), [draft]);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(inputs), 250);
    return () => clearTimeout(handle);
  }, [inputs]);
  const calc = useCalculateDeal(debounced);
  // The panel's numbers belong to `debounced` — while the user is ahead of it
  // (or the request is in flight) the figures on screen are for OLD inputs.
  // A quoted payment must never be saved in that window.
  const stale = inputs !== debounced || calc.isFetching || calc.isPlaceholderData;

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function handleSave() {
    if (!inputs || !lead.data) return;
    setSaveError(null);
    try {
      const reserveCents = fiReserve.trim() === '' ? 0 : parseMoneyToCents(fiReserve);
      if (reserveCents === null) return; // invalid reserve must never save as $0
      await createDeal.mutateAsync({
        ...inputs,
        organization_id: lead.data.organization_id,
        store_id: lead.data.store_id,
        lead_id: lead.data.id,
        ...(vehicleId === '' ? {} : { vehicle_id: vehicleId }),
        ...(soldBy === '' ? {} : { salesperson_id: soldBy }),
        fi_reserve_cents: reserveCents ?? 0,
      });
      void navigate(`/leads/${leadId}`);
    } catch (err) {
      setSaveError(t('saveError'));
      if (!(err instanceof ApiError)) throw err;
    }
  }

  if (lead.isPending) return <p className="text-sm text-muted-foreground">{t('loading')}</p>;
  if (lead.isError || !lead.data)
    return (
      <p role="alert" className="text-sm text-danger-text">
        {t('loadError')}
      </p>
    );

  const out = calc.data;
  // Label from the inputs the displayed response was computed for, not the live draft.
  const isCash = (debounced ?? inputs)?.deal_type === 'cash';
  const isLease = draft.deal_type === 'lease';
  const saleMissing = parseMoneyToCents(draft.sale_price) === null;
  const rateInvalid = draft.rate.trim() !== '' && parsePctToBps(draft.rate) === null;
  const termNum = /^\d+$/.test(draft.term.trim()) ? Number(draft.term.trim()) : null;
  const termInvalid = termNum === null || termNum < 1 || termNum > 120;
  const residualNum = /^\d+$/.test(draft.residual.trim()) ? Number(draft.residual.trim()) : null;
  const residualInvalid = isLease && (residualNum === null || residualNum > 100);
  const reserveInvalid = fiReserve.trim() !== '' && parseMoneyToCents(fiReserve) === null;
  const isHstProv = HST_PROVINCES.has(draft.province);

  return (
    <div className="space-y-4 max-lg:pb-24">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">
            {t('title')} <span className="text-muted-foreground">— {leadDisplayName(lead.data) ?? lead.data.phone}</span>
          </h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Link to={`/leads/${leadId}`} className="text-sm text-primary underline-offset-4 hover:underline">
          {t('backToLead')}
        </Link>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <section className="space-y-3 rounded-lg border border-border bg-card p-4">
            <h2 className="text-[15px] font-semibold">{t('vehicleSection')}</h2>
            <div className="space-y-1">
              <Label htmlFor="desk-vehicle">{t('vehicleLabel')}</Label>
              <Select
                id="desk-vehicle"
                value={vehicleId}
                disabled={vehicles.isPending}
                onChange={(e) => {
                  const id = e.target.value;
                  setVehicleId(id);
                  const car = vehicles.data?.items.find((veh) => veh.id === id);
                  const priceWasAuto =
                    draft.sale_price.trim() === '' || draft.sale_price === prefilledPrice;
                  if (!car) {
                    // Deselect: the phantom cost (and an auto price) leave with the car.
                    setDraft((d) => ({
                      ...d,
                      vehicle_cost: '',
                      sale_price: priceWasAuto ? '' : d.sale_price,
                    }));
                    setPrefilledPrice(null);
                    return;
                  }
                  const newPrice =
                    car.list_price_cents === null ? null : (car.list_price_cents / 100).toFixed(2);
                  setDraft((d) => ({
                    ...d,
                    vehicle_cost: (car.total_cost_cents / 100).toFixed(2),
                    sale_price: priceWasAuto ? (newPrice ?? '') : d.sale_price,
                  }));
                  setPrefilledPrice(priceWasAuto ? newPrice : prefilledPrice);
                }}
              >
                <option value="">{t('noVehicle')}</option>
                {vehicles.data?.items.map((veh) => (
                  <option key={veh.id} value={veh.id}>
                    {veh.stock_number} — {vehicleDisplayName(veh)}
                  </option>
                ))}
              </Select>
              {vehicles.isError ? (
                <p role="alert" className="text-xs text-danger-text">
                  {t('loadError')}
                </p>
              ) : null}
            </div>
            <div className="space-y-1">
              <Label htmlFor="desk-soldby">{t('soldBy')}</Label>
              <Select
                id="desk-soldby"
                value={soldBy}
                disabled={members.isPending}
                onChange={(e) => setSoldBy(e.target.value)}
              >
                <option value="">{t('noSalesperson')}</option>
                {sellers.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.name}
                  </option>
                ))}
              </Select>
              {members.isError ? (
                <p role="alert" className="text-xs text-danger-text">
                  {t('loadError')}
                </p>
              ) : null}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="desk-province">{t('province')}</Label>
                <Select
                  id="desk-province"
                  value={draft.province}
                  onChange={(e) => set('province', e.target.value as Draft['province'])}
                >
                  {ProvinceCA.options.map((p) => (
                    <option key={p} value={p}>
                      {t(PROVINCE_KEYS[p])}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="desk-type">{t('dealType')}</Label>
                <Select
                  id="desk-type"
                  value={draft.deal_type}
                  onChange={(e) => set('deal_type', e.target.value as Draft['deal_type'])}
                >
                  {(['finance', 'lease', 'cash'] as const).map((dt) => (
                    <option key={dt} value={dt}>
                      {t(DEAL_TYPE_KEYS[dt])}
                    </option>
                  ))}
                </Select>
              </div>
              <MoneyField id="desk-price" label={t('salePrice')} value={draft.sale_price} onChange={(v) => set('sale_price', v)} />
              <MoneyField id="desk-msrp" label={t('msrp')} value={draft.msrp} onChange={(v) => set('msrp', v)} />
              <MoneyField id="desk-cost" label={t('vehicleCost')} value={draft.vehicle_cost} onChange={(v) => set('vehicle_cost', v)} />
              <MoneyField id="desk-down" label={t('cashDown')} value={draft.cash_down} onChange={(v) => set('cash_down', v)} />
            </div>
            <label htmlFor="desk-exempt" className="flex items-center gap-2 text-sm max-lg:min-h-11">
              <input
                id="desk-exempt"
                type="checkbox"
                checked={draft.tax_exempt}
                onChange={(e) => set('tax_exempt', e.target.checked)}
                className="size-4 accent-[var(--primary)]"
              />
              {t('taxExempt')}
            </label>
          </section>

          <section className="space-y-3 rounded-lg border border-border bg-card p-4">
            <h2 className="text-[15px] font-semibold">{t('tradeSection')}</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <MoneyField id="desk-trade" label={t('tradeAllowance')} value={draft.trade_allowance} onChange={(v) => set('trade_allowance', v)} />
              <MoneyField id="desk-acv" label={t('tradeAcv')} value={draft.trade_acv} onChange={(v) => set('trade_acv', v)} />
              <MoneyField id="desk-lien" label={t('tradeLien')} value={draft.trade_lien} onChange={(v) => set('trade_lien', v)} />
            </div>
          </section>

          <section className="space-y-3 rounded-lg border border-border bg-card p-4">
            <h2 className="text-[15px] font-semibold">{t('fiSection')}</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <MoneyField id="desk-rebate" label={t('rebate')} value={draft.rebate} onChange={(v) => set('rebate', v)} />
              <MoneyField id="desk-fees" label={t('fees')} value={draft.fees} onChange={(v) => set('fees', v)} />
              <MoneyField id="desk-fi-price" label={t('fiPrice')} value={draft.fi_price} onChange={(v) => set('fi_price', v)} />
              <MoneyField id="desk-fi-cost" label={t('fiCost')} value={draft.fi_cost} onChange={(v) => set('fi_cost', v)} />
              <MoneyField id="desk-reserve" label={t('fiReserve')} value={fiReserve} onChange={setFiReserve} />
            </div>
            <label htmlFor="desk-fees-taxable" className="flex items-center gap-2 text-sm max-lg:min-h-11">
              <input
                id="desk-fees-taxable"
                type="checkbox"
                checked={draft.fees_taxable}
                onChange={(e) => set('fees_taxable', e.target.checked)}
                className="size-4 accent-[var(--primary)]"
              />
              {t('feesTaxable')}
            </label>
          </section>

          <section className="space-y-3 rounded-lg border border-border bg-card p-4">
            <h2 className="text-[15px] font-semibold">{t('financeSection')}</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="desk-rate">{t('rate')}</Label>
                <Input
                  id="desk-rate"
                  inputMode="decimal"
                  value={draft.rate}
                  aria-invalid={rateInvalid || undefined}
                  className={rateInvalid ? 'border-danger-border' : undefined}
                  onChange={(e) => set('rate', e.target.value)}
                />
                {rateInvalid ? (
                  <p role="alert" className="text-xs text-danger-text">
                    {t('invalidRate')}
                  </p>
                ) : null}
              </div>
              <div className="space-y-1">
                <Label htmlFor="desk-term">{t('term')}</Label>
                <Input
                  id="desk-term"
                  inputMode="numeric"
                  value={draft.term}
                  aria-invalid={termInvalid || undefined}
                  className={termInvalid ? 'border-danger-border' : undefined}
                  onChange={(e) => set('term', e.target.value)}
                />
                {termInvalid ? (
                  <p role="alert" className="text-xs text-danger-text">
                    {t('invalidTerm')}
                  </p>
                ) : null}
              </div>
              {isLease ? (
                <div className="space-y-1">
                  <Label htmlFor="desk-residual">{t('residual')}</Label>
                  <Input
                    id="desk-residual"
                    inputMode="numeric"
                    value={draft.residual}
                    aria-invalid={residualInvalid || undefined}
                    className={residualInvalid ? 'border-danger-border' : undefined}
                    onChange={(e) => set('residual', e.target.value)}
                  />
                  {residualInvalid ? (
                    <p role="alert" className="text-xs text-danger-text">
                      {t('invalidResidual')}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>
        </div>

        <aside
          className="h-fit space-y-2 rounded-lg border border-border bg-card p-4 lg:sticky lg:top-4"
          aria-live="polite"
          aria-busy={stale || undefined}
        >
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-semibold">{t('resultsTitle')}</h2>
            {stale && inputs !== null ? (
              <span className="text-xs text-muted-foreground">{t('calculating')}</span>
            ) : null}
          </div>
          {inputs === null ? (
            <p className="text-sm text-muted-foreground">
              {saleMissing ? t('enterSalePrice') : t('checkFields')}
            </p>
          ) : calc.isError ? (
            <p role="alert" className="text-sm text-danger-text">
              {t('calcError')}
            </p>
          ) : out ? (
            <div className={`space-y-1.5 ${stale ? 'opacity-50' : ''}`}>
              {isHstProv ? (
                <OutputRow label={t('hst')} cents={out.hst_cents} locale={locale} />
              ) : (
                <>
                  <OutputRow label={t('gst')} cents={out.gst_cents} locale={locale} />
                  {out.pst_cents !== 0 ? <OutputRow label={t('pst')} cents={out.pst_cents} locale={locale} /> : null}
                </>
              )}
              <OutputRow label={t('taxTotal')} cents={out.tax_total_cents} locale={locale} />
              <hr className="border-border" />
              {(debounced ?? inputs)?.deal_type === 'lease' ? null : (
                <OutputRow
                  label={isCash ? t('totalDue') : t('amountFinanced')}
                  cents={out.amount_financed_cents}
                  locale={locale}
                />
              )}
              {!isCash ? (
                <>
                  <OutputRow label={t('monthly')} cents={out.monthly_payment_cents} locale={locale} emphasis />
                  <OutputRow label={t('biweekly')} cents={out.biweekly_payment_cents} locale={locale} />
                  <OutputRow label={t('weekly')} cents={out.weekly_payment_cents} locale={locale} />
                </>
              ) : null}
              <hr className="border-border" />
              <OutputRow label={t('frontGross')} cents={out.front_gross_cents} locale={locale} />
              <OutputRow label={t('totalGross')} cents={out.total_gross_cents} locale={locale} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('calculating')}</p>
          )}
          {saveError ? (
            <p role="alert" className="text-sm text-danger-text">
              {saveError}
            </p>
          ) : null}
          <Button
            type="button"
            className="w-full"
            disabled={inputs === null || stale || reserveInvalid || createDeal.isPending}
            onClick={() => void handleSave()}
          >
            {createDeal.isPending ? t('saving') : t('save')}
          </Button>
        </aside>
      </div>

      {out && inputs !== null ? (
        <div
          className={`fixed inset-x-3 bottom-20 z-40 flex items-baseline justify-between gap-3 rounded-lg border border-border bg-card px-4 py-2.5 shadow-lg lg:hidden ${stale ? 'opacity-50' : ''}`}
        >
          <span className="text-sm text-muted-foreground">
            {isCash ? t('totalDue') : t('monthly')}
          </span>
          <span className="font-mono text-base font-semibold tabular-nums">
            {formatCents(isCash ? out.amount_financed_cents : out.monthly_payment_cents, locale)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
