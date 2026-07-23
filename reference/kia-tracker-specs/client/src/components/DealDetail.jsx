import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../supabaseClient';
import DeliveryChecklist from './DeliveryChecklist';
import SourcedUnitSection from './SourcedUnitSection';
import ExpensesPanel from './expenses/ExpensesPanel';

const API_URL = import.meta.env.VITE_API_URL;

/* ------------------------------------------------------------------ */
/*  Reusable field components                                          */
/* ------------------------------------------------------------------ */

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
        value={value ?? ''}
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
        value={value ?? ''}
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
        value={value ?? ''}
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
        checked={checked ?? false}
        onChange={onChange}
        disabled={disabled}
        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
      />
      <label className="text-sm font-medium text-gray-700">{label}</label>
    </div>
  );
}

function ReadOnlyValue({ label, value }) {
  return (
    <div>
      <dt className="text-sm font-medium text-gray-500">{label}</dt>
      <dd className="mt-1 text-sm text-gray-900">{value || '-'}</dd>
    </div>
  );
}

function ReadOnlyBool({ label, value, t }) {
  return (
    <div className="flex items-center gap-2 pt-2">
      <span className={`inline-block w-3 h-3 rounded-full ${value ? 'bg-green-500' : 'bg-gray-300'}`} />
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <span className="text-sm text-gray-500">({value ? t('common.yes') : t('common.no')})</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function DealDetail() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();

  const [deal, setDeal] = useState(null);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const [emailStatus, setEmailStatus] = useState({ closing: null, dispatch: null });

  const prevDriverDate = useRef(null);

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

  /* ---- Fetch deal ---- */
  const fetchDeal = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/deals/${id}`);
      if (res.status === 404) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setDeal(data);
      setForm({ ...data });
      prevDriverDate.current = data.driver_booked_date || null;
      setNotFound(false);
    } catch {
      setError(t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    fetchDeal();
  }, [fetchDeal]);

  /* ---- Supabase real-time subscription ---- */
  useEffect(() => {
    const channel = supabase
      .channel(`deal-${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'deals', filter: `id=eq.${id}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            navigate('/');
            return;
          }
          const updated = payload.new;
          setDeal(updated);
          if (!editing) {
            setForm({ ...updated });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, navigate, editing]);

  /* ---- Handlers ---- */
  const handleChange = (e) => {
    const { name, type, value, checked } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      const payload = { ...form };

      // Numeric coercion
      payload.year = payload.year ? Number(payload.year) : null;
      payload.money_down_amount = payload.money_down_amount ? Number(payload.money_down_amount) : 0;
      payload.cash_back_amount = payload.cash_back_amount ? Number(payload.cash_back_amount) : 0;
      payload.sale_price = payload.sale_price ? Number(payload.sale_price) : 0;
      payload.vehicle_cost = payload.vehicle_cost ? Number(payload.vehicle_cost) : 0;
      payload.fi_reserve = payload.fi_reserve ? Number(payload.fi_reserve) : 0;
      payload.trade_year = payload.trade_year ? Number(payload.trade_year) : null;
      payload.lien_amount = payload.lien_amount ? Number(payload.lien_amount) : 0;

      // Remove read-only / meta fields
      delete payload.id;
      delete payload.created_at;
      delete payload.updated_at;
      delete payload.created_by;

      const res = await fetch(`${API_URL}/deals/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || `HTTP ${res.status}`);
      }

      const updated = await res.json();
      setDeal(updated);
      setForm({ ...updated });
      setEditing(false);

      // Prompt for deal-closing email when status changed to complete
      if (updated.deal_status === 'complete' && deal.deal_status !== 'complete') {
        if (window.confirm(t('deal.prompt.sendClosingReport'))) {
          sendClosingReport();
        }
      }

      // Prompt for driver dispatch email when driver_booked_date changed
      if (updated.driver_booked_date && updated.driver_booked_date !== prevDriverDate.current) {
        if (window.confirm(t('deal.prompt.sendDriverDispatch'))) {
          sendDriverDispatch();
        }
      }
      prevDriverDate.current = updated.driver_booked_date || null;
    } catch (err) {
      setError(err.message || t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(t('common.confirmDelete'))) return;

    try {
      const res = await fetch(`${API_URL}/deals/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      navigate('/');
    } catch {
      setError(t('common.error'));
    }
  };

  const handleCancelEdit = () => {
    setForm({ ...deal });
    setEditing(false);
    setError(null);
  };

  /* ---- Status actions ---- */
  const updateDealStatus = async (newStatus) => {
    if (newStatus === 'cancelled' && !window.confirm(t('deal.prompt.confirmCancel'))) return;

    try {
      const res = await fetch(`${API_URL}/deals/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deal_status: newStatus }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated = await res.json();
      setDeal(updated);
      setForm({ ...updated });

      if (newStatus === 'complete') {
        if (window.confirm(t('deal.prompt.sendClosingReport'))) {
          sendClosingReport();
        }
      }
    } catch {
      setError(t('common.error'));
    }
  };

  /* ---- Email actions ---- */
  const sendClosingReport = async () => {
    setEmailStatus((prev) => ({ ...prev, closing: 'sending' }));
    try {
      const res = await fetch(`${API_URL}/email/deal-closing/${id}`, { method: 'POST' });
      if (!res.ok) throw new Error();
      setEmailStatus((prev) => ({ ...prev, closing: 'sent' }));
      setTimeout(() => setEmailStatus((prev) => ({ ...prev, closing: null })), 3000);
    } catch {
      setEmailStatus((prev) => ({ ...prev, closing: 'failed' }));
      setTimeout(() => setEmailStatus((prev) => ({ ...prev, closing: null })), 3000);
    }
  };

  const sendDriverDispatch = async () => {
    setEmailStatus((prev) => ({ ...prev, dispatch: 'sending' }));
    try {
      const res = await fetch(`${API_URL}/email/driver-dispatch/${id}`, { method: 'POST' });
      if (!res.ok) throw new Error();
      setEmailStatus((prev) => ({ ...prev, dispatch: 'sent' }));
      setTimeout(() => setEmailStatus((prev) => ({ ...prev, dispatch: null })), 3000);
    } catch {
      setEmailStatus((prev) => ({ ...prev, dispatch: 'failed' }));
      setTimeout(() => setEmailStatus((prev) => ({ ...prev, dispatch: null })), 3000);
    }
  };

  const emailButtonLabel = (type) => {
    const status = emailStatus[type];
    if (status === 'sending') return t('email.sending');
    if (status === 'sent') return t('email.sent');
    if (status === 'failed') return t('email.failed');
    return type === 'closing' ? t('email.sendClosingReport') : t('email.sendDriverDispatch');
  };

  /* ---- Section colors ---- */
  const sectionColors = {
    vehicle: 'bg-[#1e3a5f]',
    deal: 'bg-[#2d6a4f]',
    financial: 'bg-[#0e7490]',
    delivery: 'bg-[#7b2d8b]',
    tradeIn: 'bg-[#b45309]',
    sold: 'bg-[#c4342d]',
  };

  /* ---- Loading / Not found ---- */
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <svg className="animate-spin h-8 w-8 text-[#1e3a5f]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span className="ml-3 text-gray-600 text-sm">{t('common.loading')}</span>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500 text-lg">{t('common.notFound')}</p>
        <button onClick={() => navigate('/')} className="mt-4 text-sm text-[#1e3a5f] underline hover:text-[#162d4a]">
          {t('actions.back')}
        </button>
      </div>
    );
  }

  if (!deal || !form) return null;

  /* ---- Render ---- */
  return (
    <div className="max-w-5xl mx-auto">
      {/* Top action bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="text-sm text-[#1e3a5f] hover:underline">
            {t('actions.back')}
          </button>
          <h1 className="text-2xl font-bold text-gray-900">{t('deal.title.detail')}</h1>
          {deal.deal_status && (
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                deal.deal_status === 'complete'
                  ? 'bg-green-100 text-green-800'
                  : deal.deal_status === 'cancelled'
                  ? 'bg-red-100 text-red-800'
                  : 'bg-blue-100 text-blue-800'
              }`}
            >
              {t(`status.deal.${deal.deal_status}`)}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Email action buttons */}
          {deal.deal_status === 'complete' && (
            <button
              onClick={sendClosingReport}
              disabled={emailStatus.closing === 'sending'}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                emailStatus.closing === 'sent'
                  ? 'bg-green-100 text-green-700'
                  : emailStatus.closing === 'failed'
                  ? 'bg-red-100 text-red-700'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50'
              }`}
            >
              {emailButtonLabel('closing')}
            </button>
          )}

          {deal.driver_booked_date && (
            <button
              onClick={sendDriverDispatch}
              disabled={emailStatus.dispatch === 'sending'}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                emailStatus.dispatch === 'sent'
                  ? 'bg-green-100 text-green-700'
                  : emailStatus.dispatch === 'failed'
                  ? 'bg-red-100 text-red-700'
                  : 'bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50'
              }`}
            >
              {emailButtonLabel('dispatch')}
            </button>
          )}

          {/* Desk this deal */}
          <button
            onClick={() => navigate(`/desking?dealId=${deal.id}`)}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-teal-600 text-white hover:bg-teal-700 transition-colors"
          >
            {t('actions.deskDeal')}
          </button>

          {/* Status change buttons */}
          {deal.deal_status !== 'complete' && deal.deal_status !== 'cancelled' && (
            <button
              onClick={() => updateDealStatus('complete')}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-green-600 text-white hover:bg-green-700 transition-colors"
            >
              {t('actions.markComplete')}
            </button>
          )}

          {deal.deal_status !== 'cancelled' && (
            <button
              onClick={() => updateDealStatus('cancelled')}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-red-600 text-white hover:bg-red-700 transition-colors"
            >
              {t('actions.cancelDeal')}
            </button>
          )}

          {/* Edit / Delete */}
          {!editing ? (
            <>
              <button
                onClick={() => setEditing(true)}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-[#1e3a5f] text-white hover:bg-[#162d4a] transition-colors"
              >
                {t('actions.edit')}
              </button>
              <button
                onClick={handleDelete}
                className="px-3 py-1.5 text-xs font-medium rounded-md border border-red-300 text-red-600 hover:bg-red-50 transition-colors"
              >
                {t('actions.delete')}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-[#1e3a5f] text-white hover:bg-[#162d4a] disabled:opacity-50 transition-colors"
              >
                {saving ? t('common.loading') : t('actions.save')}
              </button>
              <button
                onClick={handleCancelEdit}
                className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
              >
                {t('actions.cancel')}
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-6">
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
              {editing ? (
                <>
                  <TextField label={t('deal.fields.stockNumber')} name="stock_number" value={form.stock_number} onChange={handleChange} />
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
                </>
              ) : (
                <>
                  <ReadOnlyValue label={t('deal.fields.stockNumber')} value={deal.stock_number} />
                  <ReadOnlyValue label={t('deal.fields.vin')} value={deal.vin} />
                  <ReadOnlyValue label={t('deal.fields.year')} value={deal.year} />
                  <ReadOnlyValue label={t('deal.fields.make')} value={deal.make} />
                  <ReadOnlyValue label={t('deal.fields.model')} value={deal.model} />
                  <ReadOnlyValue label={t('deal.fields.color')} value={deal.color} />
                  <ReadOnlyValue label={t('deal.fields.vehicleSource')} value={deal.vehicle_source} />
                  <ReadOnlyValue label={t('deal.fields.vehicleStatus')} value={deal.vehicle_status ? t(`status.vehicle.${deal.vehicle_status}`) : '-'} />
                  <ReadOnlyValue label={t('deal.fields.saleType')} value={deal.sale_type ? t(`saleType.${deal.sale_type}`) : '-'} />
                  <ReadOnlyBool label={t('deal.fields.listedOnline')} value={deal.listed_online} t={t} />
                  <ReadOnlyBool label={t('deal.fields.isSourcedUnit')} value={deal.is_sourced_unit} t={t} />
                </>
              )}
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
              {editing ? (
                <>
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
                </>
              ) : (
                <>
                  <ReadOnlyValue label={t('deal.fields.customerName')} value={deal.customer_name} />
                  <ReadOnlyValue label={t('deal.fields.customerPhone')} value={deal.customer_phone} />
                  <div className="md:col-span-2">
                    <ReadOnlyValue label={t('deal.fields.customerAddress')} value={deal.customer_address} />
                  </div>
                  <ReadOnlyBool label={t('deal.fields.hasCosigner')} value={deal.has_cosigner} t={t} />
                  {deal.has_cosigner && (
                    <ReadOnlyValue label={t('deal.fields.cosignerName')} value={deal.cosigner_name} />
                  )}
                  <ReadOnlyValue label={t('deal.fields.salespersonName')} value={deal.salesperson_name} />
                  <ReadOnlyValue label={t('deal.fields.financingBank')} value={deal.financing_bank} />
                  <ReadOnlyValue label={t('deal.fields.financeStatus')} value={deal.finance_status ? t(`status.finance.${deal.finance_status}`) : '-'} />
                  <ReadOnlyValue label={t('deal.fields.moneyDownAmount')} value={deal.money_down_amount} />
                  <ReadOnlyBool label={t('deal.fields.moneyDownCollected')} value={deal.money_down_collected} t={t} />
                  <ReadOnlyValue label={t('deal.fields.cashBackAmount')} value={deal.cash_back_amount} />
                  <ReadOnlyBool label={t('deal.fields.cashBackSent')} value={deal.cash_back_sent} t={t} />
                  <div className="md:col-span-2">
                    <ReadOnlyValue label={t('deal.fields.accessories')} value={deal.accessories} />
                  </div>
                  <ReadOnlyBool label={t('deal.fields.nativeStatus')} value={deal.native_status} t={t} />
                </>
              )}
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
              {editing ? (
                <>
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
                </>
              ) : (
                <>
                  <ReadOnlyValue label={t('deal.fields.salePrice')} value={deal.sale_price ? `$${Number(deal.sale_price).toLocaleString('en-CA', { minimumFractionDigits: 2 })}` : '-'} />
                  <ReadOnlyValue label={t('deal.fields.vehicleCost')} value={deal.vehicle_cost ? `$${Number(deal.vehicle_cost).toLocaleString('en-CA', { minimumFractionDigits: 2 })}` : '-'} />
                  <ReadOnlyValue label={t('deal.fields.fiReserve')} value={deal.fi_reserve ? `$${Number(deal.fi_reserve).toLocaleString('en-CA', { minimumFractionDigits: 2 })}` : '-'} />
                  <div className="md:col-span-3 grid grid-cols-2 gap-4 pt-2 border-t border-gray-100">
                    <div>
                      <dt className="text-sm font-medium text-gray-500">{t('deal.fields.grossProfit')}</dt>
                      <dd className="mt-1 text-lg font-semibold text-gray-900">
                        ${((Number(deal.sale_price) || 0) - (Number(deal.vehicle_cost) || 0)).toLocaleString('en-CA', { minimumFractionDigits: 2 })}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">{t('deal.fields.totalGross')}</dt>
                      <dd className="mt-1 text-lg font-semibold text-green-700">
                        ${((Number(deal.sale_price) || 0) - (Number(deal.vehicle_cost) || 0) + (Number(deal.fi_reserve) || 0)).toLocaleString('en-CA', { minimumFractionDigits: 2 })}
                      </dd>
                    </div>
                  </div>
                </>
              )}
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
              {editing ? (
                <>
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
                </>
              ) : (
                <>
                  <ReadOnlyValue label={t('deal.fields.tentativeDeliveryDate')} value={deal.tentative_delivery_date || null} />
                  <ReadOnlyValue label={t('deal.fields.deliveryDate')} value={deal.delivery_date ? new Date(deal.delivery_date).toLocaleString() : null} />
                  <ReadOnlyValue label={t('deal.fields.driverBookedDate')} value={deal.driver_booked_date ? new Date(deal.driver_booked_date).toLocaleString() : null} />
                  <ReadOnlyValue label={t('deal.fields.chaserVehicleInfo')} value={deal.chaser_vehicle_info} />
                  <ReadOnlyValue label={t('deal.fields.pickupLocation')} value={deal.pickup_location} />
                  <div className="md:col-span-2">
                    <ReadOnlyValue label={t('deal.fields.deliveryAddress')} value={deal.delivery_address} />
                  </div>
                  <ReadOnlyValue label={t('deal.fields.licensingProvince')} value={deal.licensing_province ? t(`province.${deal.licensing_province}`) : '-'} />
                  <ReadOnlyBool label={t('deal.fields.licensingCompleted')} value={deal.licensing_completed} t={t} />
                  <ReadOnlyBool label={t('deal.fields.photosTaken')} value={deal.photos_taken} t={t} />
                  <ReadOnlyBool label={t('deal.fields.wetInkSigned')} value={deal.wet_ink_signed} t={t} />
                  <ReadOnlyBool label={t('deal.fields.idvCompleted')} value={deal.idv_completed} t={t} />
                </>
              )}
            </div>
          )}
        </div>

        {/* SECTION 3B - Pre-Delivery Checklist */}
        {deal.tentative_delivery_date && (
          <DeliveryChecklist dealId={id} editing={editing} />
        )}

        {/* SECTION 3C - Sourced Unit Details */}
        {deal.is_sourced_unit && (
          <SourcedUnitSection dealId={id} editing={editing} />
        )}

        {/* SECTION 3D - Expenses */}
        <ExpensesPanel
          dealId={deal.id}
          stockNumber={deal.stock_number}
          isManager={true}
        />

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
              {editing ? (
                <>
                  <CheckboxField label={t('deal.fields.hasTradeIn')} name="has_trade_in" checked={form.has_trade_in} onChange={handleChange} />
                  {form.has_trade_in && (
                    <>
                      <div />
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
                </>
              ) : (
                <>
                  <ReadOnlyBool label={t('deal.fields.hasTradeIn')} value={deal.has_trade_in} t={t} />
                  {deal.has_trade_in && (
                    <>
                      <div />
                      <ReadOnlyValue label={t('deal.fields.tradeYear')} value={deal.trade_year} />
                      <ReadOnlyValue label={t('deal.fields.tradeMake')} value={deal.trade_make} />
                      <ReadOnlyValue label={t('deal.fields.tradeModel')} value={deal.trade_model} />
                      <ReadOnlyValue label={t('deal.fields.tradeColor')} value={deal.trade_color} />
                      <ReadOnlyValue label={t('deal.fields.tradePlate')} value={deal.trade_plate} />
                      <ReadOnlyValue label={t('deal.fields.tradeVin')} value={deal.trade_vin} />
                      <ReadOnlyValue label={t('deal.fields.tradeStockNumber')} value={deal.trade_stock_number} />
                      <ReadOnlyBool label={t('deal.fields.hasLien')} value={deal.has_lien} t={t} />
                      {deal.has_lien && (
                        <>
                          <ReadOnlyValue label={t('deal.fields.lienBank')} value={deal.lien_bank} />
                          <ReadOnlyValue label={t('deal.fields.lienAmount')} value={deal.lien_amount} />
                        </>
                      )}
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
              {editing ? (
                <>
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
                </>
              ) : (
                <>
                  <ReadOnlyBool label={t('deal.fields.isSold')} value={deal.is_sold} t={t} />
                  {deal.is_sold && (
                    <ReadOnlyValue label={t('deal.fields.soldType')} value={deal.sold_type ? t(`saleType.${deal.sold_type}`) : '-'} />
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
