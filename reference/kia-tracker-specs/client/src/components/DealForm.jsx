import { useState, useCallback, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Search, AlertTriangle, CheckCircle2, X } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL;

const INITIAL_FORM = {
  // Vehicle Info
  stock_number: '',
  vin: '',
  year: '',
  make: '',
  model: '',
  color: '',
  vehicle_source: '',
  vehicle_status: 'incoming',
  sale_type: 'retail',
  listed_online: false,
  is_sourced_unit: false,
  // Deal Info
  customer_name: '',
  customer_address: '',
  customer_phone: '',
  has_cosigner: false,
  cosigner_name: '',
  salesperson_name: '',
  financing_bank: '',
  finance_status: 'pending',
  money_down_amount: '',
  money_down_collected: false,
  cash_back_amount: '',
  cash_back_sent: false,
  accessories: '',
  native_status: false,
  // Delivery Info
  tentative_delivery_date: '',
  delivery_date: '',
  driver_booked_date: '',
  chaser_vehicle_info: '',
  pickup_location: '',
  delivery_address: '',
  licensing_province: 'ontario',
  licensing_completed: false,
  photos_taken: false,
  wet_ink_signed: false,
  idv_completed: false,
  // Trade-In Info
  has_trade_in: false,
  trade_year: '',
  trade_make: '',
  trade_model: '',
  trade_color: '',
  trade_plate: '',
  trade_vin: '',
  trade_stock_number: '',
  has_lien: false,
  lien_bank: '',
  lien_amount: '',
  // Financial Info
  sale_price: '',
  vehicle_cost: '',
  fi_reserve: '',
  // Sold Info
  is_sold: false,
  sold_type: 'retail',
};

function SectionHeader({ title, isOpen, onToggle, color }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`w-full flex items-center justify-between px-4 py-3 rounded-t-lg text-white font-semibold text-sm ${color}`}
    >
      <span>{title}</span>
      <svg
        className={`w-5 h-5 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  );
}

function TextField({ label, name, value, onChange, type = 'text', required = false, disabled = false }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        required={required}
        disabled={disabled}
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
      />
    </div>
  );
}

function TextAreaField({ label, name, value, onChange, disabled = false }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <textarea
        name={name}
        value={value}
        onChange={onChange}
        rows={3}
        disabled={disabled}
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
      />
    </div>
  );
}

function SelectField({ label, name, value, onChange, options, disabled = false }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <select
        name={name}
        value={value}
        onChange={onChange}
        disabled={disabled}
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function CheckboxField({ label, name, checked, onChange, disabled = false }) {
  return (
    <div className="flex items-center gap-2 pt-6">
      <input
        type="checkbox"
        name={name}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
      />
      <label className="text-sm font-medium text-gray-700">{label}</label>
    </div>
  );
}

export default function DealForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const [form, setForm] = useState(INITIAL_FORM);

  // Hydrate from source deal if navigated via Convert to Deal
  useEffect(() => {
    const prefill = location.state;
    if (!prefill?.sourceDealId) return;
    const provinceMap = { QC: 'quebec', ON: 'ontario', AB: 'other', BC: 'other' };
    (async () => {
      try {
        const res = await fetch(`${API_URL}/deals/${prefill.sourceDealId}`);
        if (!res.ok) return;
        const d = await res.json();
        setForm((f) => ({
          ...f,
          stock_number: d.stock_number || '',
          vin: d.vin || '',
          year: d.vehicle_year || d.year || '',
          make: d.vehicle_make || d.make || '',
          model: d.vehicle_model || d.model || '',
          color: d.vehicle_color || d.color || '',
          vehicle_source: d.vehicle_source || '',
          vehicle_status: d.vehicle_status || f.vehicle_status,
          sale_type: d.sale_type || f.sale_type,
          listed_online: d.listed_online ?? f.listed_online,
          is_sourced_unit: d.is_sourced_unit ?? f.is_sourced_unit,
          customer_name: d.customer_name || '',
          customer_phone: d.customer_phone || '',
          customer_address: d.customer_address || '',
          has_cosigner: d.has_cosigner ?? false,
          cosigner_name: d.cosigner_name || '',
          financing_bank: d.financing_bank || '',
          finance_status: d.finance_status || f.finance_status,
          sale_price: d.sale_price || '',
          vehicle_cost: d.vehicle_cost || '',
          fi_reserve: d.fi_reserve || '',
          money_down_amount: d.money_down_amount || '',
          native_status: d.native_status ?? false,
          licensing_province: provinceMap[prefill.province] || f.licensing_province,
          has_trade_in: d.has_trade_in ?? false,
          trade_year: d.trade_year || '',
          trade_make: d.trade_make || '',
          trade_model: d.trade_model || '',
          trade_color: d.trade_color || '',
          trade_vin: d.trade_vin || '',
          trade_stock_number: d.trade_stock_number || '',
          has_lien: d.has_lien ?? false,
          lien_bank: d.lien_bank || '',
          lien_amount: d.lien_amount || '',
        }));
      } catch (err) {
        console.error('Failed to load source deal:', err);
      }
    })();
  }, []);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [stockLookup, setStockLookup] = useState({ status: null, message: '', vehicle: null });
  const [conflictModal, setConflictModal] = useState(null);

  const { data: inventory = [] } = useQuery({
    queryKey: ['inventory-all'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/inventory`);
      if (!res.ok) return [];
      const d = await res.json();
      return Array.isArray(d) ? d : d.data || [];
    },
    staleTime: 60000,
  });

  const lookupStock = useCallback(() => {
    const stockNum = form.stock_number?.trim();
    if (!stockNum) { setStockLookup({ status: null, message: '', vehicle: null }); return; }

    const match = inventory.find(v =>
      (v.stock_number || '').toLowerCase() === stockNum.toLowerCase()
    );

    if (!match) {
      setStockLookup({ status: 'not_found', message: 'No inventory match for this stock number', vehicle: null });
      return;
    }

    if (match.deal_status === 'pending' || match.deal_status === 'sold') {
      setConflictModal({
        stock: stockNum,
        status: match.deal_status.toUpperCase(),
        vehicle: `${match.year || ''} ${match.make || ''} ${match.model || ''}`.trim(),
      });
      setStockLookup({ status: null, message: '', vehicle: null });
      return;
    }

    const modelWithTrim = [match.model, match.trim].filter(Boolean).join(' ');
    setForm(prev => ({
      ...prev,
      vin: match.vin || prev.vin,
      year: match.year || prev.year,
      make: match.make || prev.make,
      model: modelWithTrim || prev.model,
      color: match.color || match.exterior_color || prev.color,
    }));
    const desc = `${match.year || ''} ${match.make || ''} ${modelWithTrim || ''}`.trim();
    setStockLookup({ status: 'found', message: `Found: ${desc} — fields auto-populated`, vehicle: match });
  }, [form.stock_number, inventory]);

  useEffect(() => {
    if (!form.has_trade_in) return;
    if (form.trade_stock_number) return;
    const base = form.stock_number?.trim();
    if (!base) return;

    const allStocks = inventory.map(v => v.stock_number).filter(Boolean);
    const baseNum = base.replace(/[^0-9]/g, '');
    if (!baseNum) return;

    const existing = allStocks
      .filter(s => s.startsWith(baseNum) && s.length > baseNum.length)
      .map(s => s.slice(baseNum.length).toUpperCase())
      .filter(suffix => /^[A-Z]$/.test(suffix));

    let nextChar = 'A';
    if (existing.length > 0) {
      existing.sort();
      const lastChar = existing[existing.length - 1];
      nextChar = String.fromCharCode(lastChar.charCodeAt(0) + 1);
    }

    setForm(f => ({ ...f, trade_stock_number: baseNum + nextChar }));
  }, [form.has_trade_in, form.stock_number, inventory]);

  const handleChange = (e) => {
    const { name, type, value, checked } = e.target;
    setForm((prev) => {
      const next = { ...prev, [name]: type === 'checkbox' ? checked : value };
      if (name === 'has_trade_in' && !checked) {
        next.trade_stock_number = '';
      }
      return next;
    });
  };

  const [openSections, setOpenSections] = useState({
    vehicle: true,
    deal: true,
    financial: true,
    delivery: true,
    tradeIn: true,
    sold: true,
  });

  const toggleSection = (key) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };


  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const userJson = localStorage.getItem('kia_user');
      const user = userJson ? JSON.parse(userJson) : null;

      const payload = {
        ...form,
        year: form.year ? Number(form.year) : null,
        money_down_amount: form.money_down_amount ? Number(form.money_down_amount) : 0,
        cash_back_amount: form.cash_back_amount ? Number(form.cash_back_amount) : 0,
        sale_price: form.sale_price ? Number(form.sale_price) : 0,
        vehicle_cost: form.vehicle_cost ? Number(form.vehicle_cost) : 0,
        fi_reserve: form.fi_reserve ? Number(form.fi_reserve) : 0,
        trade_year: form.trade_year ? Number(form.trade_year) : null,
        lien_amount: form.lien_amount ? Number(form.lien_amount) : 0,
        created_by: user?.id || null,
      };

      // Strip trade-in fields if no trade-in
      if (!payload.has_trade_in) {
        delete payload.trade_year;
        delete payload.trade_make;
        delete payload.trade_model;
        delete payload.trade_color;
        delete payload.trade_plate;
        delete payload.trade_vin;
        delete payload.trade_stock_number;
        delete payload.has_lien;
        delete payload.lien_bank;
        delete payload.lien_amount;
      }

      // Strip lien fields if no lien
      if (!payload.has_lien) {
        delete payload.lien_bank;
        delete payload.lien_amount;
      }

      // Strip cosigner if not applicable
      if (!payload.has_cosigner) {
        delete payload.cosigner_name;
      }

      // Strip sold_type if not sold
      if (!payload.is_sold) {
        delete payload.sold_type;
      }

      const res = await fetch(`${API_URL}/deals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || `HTTP ${res.status}`);
      }

      const created = await res.json();
      navigate(`/deal/${created.id}`);
    } catch (err) {
      setError(err.message || t('common.error'));
    } finally {
      setSubmitting(false);
    }
  };

  const sectionColors = {
    vehicle: 'bg-[#1e3a5f]',
    deal: 'bg-[#2d6a4f]',
    financial: 'bg-[#0e7490]',
    delivery: 'bg-[#7b2d8b]',
    tradeIn: 'bg-[#b45309]',
    sold: 'bg-[#c4342d]',
  };

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">{t('deal.title.new')}</h1>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* SECTION 1 - Vehicle Info */}
        <div className="bg-white rounded-lg shadow">
          <SectionHeader
            title={t('deal.sections.vehicleInfo')}
            isOpen={openSections.vehicle}
            onToggle={() => toggleSection('vehicle')}
            color={sectionColors.vehicle}
          />
          {openSections.vehicle && (
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Stock Number with Lookup */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('deal.fields.stockNumber')}</label>
                <div className="flex gap-1.5">
                  <input
                    type="text" name="stock_number" value={form.stock_number}
                    onChange={handleChange}
                    onBlur={lookupStock}
                    className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                  <button type="button" onClick={lookupStock}
                    className="px-3 py-2 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700 flex items-center gap-1">
                    <Search size={14} /> Lookup
                  </button>
                </div>
                {stockLookup.status === 'found' && (
                  <p className="mt-1 text-xs text-green-600 flex items-center gap-1">
                    <CheckCircle2 size={12} /> {stockLookup.message}
                  </p>
                )}
                {stockLookup.status === 'not_found' && (
                  <p className="mt-1 text-xs text-amber-600 flex items-center gap-1">
                    <AlertTriangle size={12} /> {stockLookup.message}
                  </p>
                )}
              </div>
              <TextField label={t('deal.fields.vin')} name="vin" value={form.vin} onChange={handleChange} />
              <TextField label={t('deal.fields.year')} name="year" type="number" value={form.year} onChange={handleChange} />
              <TextField label={t('deal.fields.make')} name="make" value={form.make} onChange={handleChange} />
              <TextField label={t('deal.fields.model')} name="model" value={form.model} onChange={handleChange} />
              <TextField label={t('deal.fields.color')} name="color" value={form.color} onChange={handleChange} />
              <TextField label={t('deal.fields.vehicleSource')} name="vehicle_source" value={form.vehicle_source} onChange={handleChange} />
              <SelectField
                label={t('deal.fields.vehicleStatus')}
                name="vehicle_status"
                value={form.vehicle_status}
                onChange={handleChange}
                options={[
                  { value: 'incoming', label: t('status.vehicle.incoming') },
                  { value: 'at_garage', label: t('status.vehicle.at_garage') },
                  { value: 'delivered', label: t('status.vehicle.delivered') },
                ]}
              />
              <SelectField
                label={t('deal.fields.saleType')}
                name="sale_type"
                value={form.sale_type}
                onChange={handleChange}
                options={[
                  { value: 'retail', label: t('saleType.retail') },
                  { value: 'wholesale', label: t('saleType.wholesale') },
                ]}
              />
              <CheckboxField label={t('deal.fields.listedOnline')} name="listed_online" checked={form.listed_online} onChange={handleChange} />
              <CheckboxField label={t('deal.fields.isSourcedUnit')} name="is_sourced_unit" checked={form.is_sourced_unit} onChange={handleChange} />
            </div>
          )}
        </div>

        {/* SECTION 2 - Deal Info */}
        <div className="bg-white rounded-lg shadow">
          <SectionHeader
            title={t('deal.sections.dealInfo')}
            isOpen={openSections.deal}
            onToggle={() => toggleSection('deal')}
            color={sectionColors.deal}
          />
          {openSections.deal && (
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <TextField label={t('deal.fields.customerName')} name="customer_name" value={form.customer_name} onChange={handleChange} required />
              <TextField label={t('deal.fields.customerPhone')} name="customer_phone" value={form.customer_phone} onChange={handleChange} />
              <div className="md:col-span-2">
                <TextAreaField label={t('deal.fields.customerAddress')} name="customer_address" value={form.customer_address} onChange={handleChange} />
              </div>
              <CheckboxField label={t('deal.fields.hasCosigner')} name="has_cosigner" checked={form.has_cosigner} onChange={handleChange} />
              {form.has_cosigner && (
                <TextField label={t('deal.fields.cosignerName')} name="cosigner_name" value={form.cosigner_name} onChange={handleChange} />
              )}
              <TextField label={t('deal.fields.salespersonName')} name="salesperson_name" value={form.salesperson_name} onChange={handleChange} />
              <TextField label={t('deal.fields.financingBank')} name="financing_bank" value={form.financing_bank} onChange={handleChange} />
              <SelectField
                label={t('deal.fields.financeStatus')}
                name="finance_status"
                value={form.finance_status}
                onChange={handleChange}
                options={[
                  { value: 'pending', label: t('status.finance.pending') },
                  { value: 'approved', label: t('status.finance.approved') },
                  { value: 'funded', label: t('status.finance.funded') },
                ]}
              />
              <TextField label={t('deal.fields.moneyDownAmount')} name="money_down_amount" type="number" value={form.money_down_amount} onChange={handleChange} />
              <CheckboxField label={t('deal.fields.moneyDownCollected')} name="money_down_collected" checked={form.money_down_collected} onChange={handleChange} />
              <TextField label={t('deal.fields.cashBackAmount')} name="cash_back_amount" type="number" value={form.cash_back_amount} onChange={handleChange} />
              <CheckboxField label={t('deal.fields.cashBackSent')} name="cash_back_sent" checked={form.cash_back_sent} onChange={handleChange} />
              <div className="md:col-span-2">
                <TextAreaField label={t('deal.fields.accessories')} name="accessories" value={form.accessories} onChange={handleChange} />
              </div>
              <CheckboxField label={t('deal.fields.nativeStatus')} name="native_status" checked={form.native_status} onChange={handleChange} />
            </div>
          )}
        </div>

        {/* SECTION - Financial Info */}
        <div className="bg-white rounded-lg shadow">
          <SectionHeader
            title={t('deal.sections.financialInfo')}
            isOpen={openSections.financial}
            onToggle={() => toggleSection('financial')}
            color={sectionColors.financial}
          />
          {openSections.financial && (
            <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              <TextField label={t('deal.fields.salePrice')} name="sale_price" type="number" value={form.sale_price} onChange={handleChange} />
              <TextField label={t('deal.fields.vehicleCost')} name="vehicle_cost" type="number" value={form.vehicle_cost} onChange={handleChange} />
              <TextField label={t('deal.fields.fiReserve')} name="fi_reserve" type="number" value={form.fi_reserve} onChange={handleChange} />
              <div className="md:col-span-3 grid grid-cols-2 gap-4 pt-2 border-t border-gray-100">
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">{t('deal.fields.grossProfit')}</label>
                  <p className="text-lg font-semibold text-gray-900">
                    ${((Number(form.sale_price) || 0) - (Number(form.vehicle_cost) || 0)).toLocaleString('en-CA', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">{t('deal.fields.totalGross')}</label>
                  <p className="text-lg font-semibold text-green-700">
                    ${((Number(form.sale_price) || 0) - (Number(form.vehicle_cost) || 0) + (Number(form.fi_reserve) || 0)).toLocaleString('en-CA', { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* SECTION 3 - Delivery Info */}
        <div className="bg-white rounded-lg shadow">
          <SectionHeader
            title={t('deal.sections.deliveryInfo')}
            isOpen={openSections.delivery}
            onToggle={() => toggleSection('delivery')}
            color={sectionColors.delivery}
          />
          {openSections.delivery && (
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <TextField label={t('deal.fields.tentativeDeliveryDate')} name="tentative_delivery_date" type="date" value={form.tentative_delivery_date} onChange={handleChange} />
              <TextField label={t('deal.fields.deliveryDate')} name="delivery_date" type="datetime-local" value={form.delivery_date} onChange={handleChange} />
              <TextField label={t('deal.fields.driverBookedDate')} name="driver_booked_date" type="datetime-local" value={form.driver_booked_date} onChange={handleChange} />
              <TextField label={t('deal.fields.chaserVehicleInfo')} name="chaser_vehicle_info" value={form.chaser_vehicle_info} onChange={handleChange} />
              <TextField label={t('deal.fields.pickupLocation')} name="pickup_location" value={form.pickup_location} onChange={handleChange} />
              <div className="md:col-span-2">
                <TextAreaField label={t('deal.fields.deliveryAddress')} name="delivery_address" value={form.delivery_address} onChange={handleChange} />
              </div>
              <SelectField
                label={t('deal.fields.licensingProvince')}
                name="licensing_province"
                value={form.licensing_province}
                onChange={handleChange}
                options={[
                  { value: 'ontario', label: t('province.ontario') },
                  { value: 'quebec', label: t('province.quebec') },
                  { value: 'other', label: t('province.other') },
                ]}
              />
              <CheckboxField label={t('deal.fields.licensingCompleted')} name="licensing_completed" checked={form.licensing_completed} onChange={handleChange} />
              <CheckboxField label={t('deal.fields.photosTaken')} name="photos_taken" checked={form.photos_taken} onChange={handleChange} />
              <CheckboxField label={t('deal.fields.wetInkSigned')} name="wet_ink_signed" checked={form.wet_ink_signed} onChange={handleChange} />
              <CheckboxField label={t('deal.fields.idvCompleted')} name="idv_completed" checked={form.idv_completed} onChange={handleChange} />
            </div>
          )}
        </div>

        {/* SECTION 4 - Trade-In Info */}
        <div className="bg-white rounded-lg shadow">
          <SectionHeader
            title={t('deal.sections.tradeInInfo')}
            isOpen={openSections.tradeIn}
            onToggle={() => toggleSection('tradeIn')}
            color={sectionColors.tradeIn}
          />
          {openSections.tradeIn && (
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <CheckboxField label={t('deal.fields.hasTradeIn')} name="has_trade_in" checked={form.has_trade_in} onChange={handleChange} />
              {form.has_trade_in && (
                <>
                  <div /> {/* spacer for grid alignment */}
                  <TextField label={t('deal.fields.tradeYear')} name="trade_year" type="number" value={form.trade_year} onChange={handleChange} />
                  <TextField label={t('deal.fields.tradeMake')} name="trade_make" value={form.trade_make} onChange={handleChange} />
                  <TextField label={t('deal.fields.tradeModel')} name="trade_model" value={form.trade_model} onChange={handleChange} />
                  <TextField label={t('deal.fields.tradeColor')} name="trade_color" value={form.trade_color} onChange={handleChange} />
                  <TextField label={t('deal.fields.tradePlate')} name="trade_plate" value={form.trade_plate} onChange={handleChange} />
                  <TextField label={t('deal.fields.tradeVin')} name="trade_vin" value={form.trade_vin} onChange={handleChange} />
                  <TextField label={t('deal.fields.tradeStockNumber')} name="trade_stock_number" value={form.trade_stock_number} onChange={handleChange} />
                  <CheckboxField label={t('deal.fields.hasLien')} name="has_lien" checked={form.has_lien} onChange={handleChange} />
                  {form.has_lien && (
                    <>
                      <TextField label={t('deal.fields.lienBank')} name="lien_bank" value={form.lien_bank} onChange={handleChange} />
                      <TextField label={t('deal.fields.lienAmount')} name="lien_amount" type="number" value={form.lien_amount} onChange={handleChange} />
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* SECTION 5 - Sold Info */}
        <div className="bg-white rounded-lg shadow">
          <SectionHeader
            title={t('deal.sections.soldInfo')}
            isOpen={openSections.sold}
            onToggle={() => toggleSection('sold')}
            color={sectionColors.sold}
          />
          {openSections.sold && (
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <CheckboxField label={t('deal.fields.isSold')} name="is_sold" checked={form.is_sold} onChange={handleChange} />
              {form.is_sold && (
                <SelectField
                  label={t('deal.fields.soldType')}
                  name="sold_type"
                  value={form.sold_type}
                  onChange={handleChange}
                  options={[
                    { value: 'retail', label: t('saleType.retail') },
                    { value: 'wholesale', label: t('saleType.wholesale') },
                  ]}
                />
              )}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="px-5 py-2.5 text-sm font-medium rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors"
          >
            {t('actions.cancel')}
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-5 py-2.5 text-sm font-medium rounded-md bg-[#1e3a5f] text-white hover:bg-[#162d4a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? t('common.loading') : t('actions.save')}
          </button>
        </div>
      </form>

      {/* Vehicle Conflict Modal */}
      {conflictModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 text-center">
            <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle size={28} className="text-red-600" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">Vehicle Unavailable</h3>
            <p className="text-sm text-gray-600 mb-1">
              <span className="font-semibold">{conflictModal.vehicle}</span> (Stock #{conflictModal.stock})
            </p>
            <p className="text-sm text-gray-600 mb-4">
              This vehicle is currently <span className="font-bold text-red-600">{conflictModal.status}</span> on another deal.
              The previous deal must be cancelled before this vehicle can be assigned to a new deal.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConflictModal(null)}
                className="flex-1 px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50">
                Dismiss
              </button>
              <button onClick={() => { setForm(f => ({ ...f, stock_number: '' })); setConflictModal(null); }}
                className="flex-1 px-4 py-2 rounded-lg bg-red-600 text-white text-sm hover:bg-red-700">
                Clear Stock #
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
