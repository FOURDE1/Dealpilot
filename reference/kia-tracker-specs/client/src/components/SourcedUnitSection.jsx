import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import FileUpload from './FileUpload';

const API_URL = import.meta.env.VITE_API_URL;

/* ---- Helper components ---- */

function SectionCard({ title, icon, children, highlight }) {
  return (
    <div className={`rounded-lg border p-4 space-y-3 ${highlight ? 'bg-green-50 border-green-300' : 'bg-white border-gray-200'}`}>
      <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
        <span>{icon}</span> {title}
      </h4>
      {children}
    </div>
  );
}

function StatusPill({ value, trueLabel, falseLabel }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border
      ${value
        ? 'bg-green-100 text-green-800 border-green-300'
        : 'bg-gray-100 text-gray-500 border-gray-200'}`}>
      <span className={`w-2 h-2 rounded-full ${value ? 'bg-green-500' : 'bg-gray-400'}`} />
      {value ? trueLabel : falseLabel}
    </span>
  );
}

function ReadField({ label, value }) {
  return (
    <div>
      <dt className="text-xs font-medium text-gray-400 uppercase tracking-wide">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-gray-800">{value || '—'}</dd>
    </div>
  );
}

function TextField({ label, name, value, onChange, type = 'text', placeholder }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        type={type} name={name} value={value ?? ''} onChange={onChange}
        placeholder={placeholder}
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm
          focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
      />
    </div>
  );
}

function SelectField({ label, name, value, onChange, options }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <select
        name={name} value={value ?? ''} onChange={onChange}
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm
          focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function ToggleButtons({ label, name, value, trueLabel, falseLabel, onChange }) {
  return (
    <div>
      {label && <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onChange({ target: { name, type: 'checkbox', checked: true } })}
          className={`flex-1 py-2 px-3 rounded-md text-sm font-semibold border-2 transition-all
            ${value ? 'bg-green-100 border-green-500 text-green-800' : 'bg-white border-gray-200 text-gray-500 hover:border-green-400'}`}
        >{trueLabel}</button>
        <button
          type="button"
          onClick={() => onChange({ target: { name, type: 'checkbox', checked: false } })}
          className={`flex-1 py-2 px-3 rounded-md text-sm font-semibold border-2 transition-all
            ${!value ? 'bg-yellow-100 border-yellow-500 text-yellow-800' : 'bg-white border-gray-200 text-gray-500 hover:border-yellow-400'}`}
        >{falseLabel}</button>
      </div>
    </div>
  );
}

function FileUploadField({ label, name, value, onChange }) {
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState('');

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    setUploadError('');
    try {
      const ext = file.name.split('.').pop();
      const path = `deposit-receipts/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage
        .from('receipts')
        .upload(path, file, { upsert: true });
      if (error) throw error;
      const { data: urlData } = supabase.storage.from('receipts').getPublicUrl(path);
      onChange({ target: { name, value: urlData.publicUrl } });
    } catch (err) {
      setUploadError('Upload failed: ' + (err.message || err));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</label>
      {value && (
        <a href={value} target="_blank" rel="noreferrer"
           className="text-xs text-blue-600 underline truncate max-w-xs">
          View Receipt
        </a>
      )}
      <input
        type="file"
        accept=".pdf,.jpg,.jpeg,.png"
        onChange={handleFileChange}
        disabled={uploading}
        className="text-sm text-gray-600 file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
      />
      {uploading && <span className="text-xs text-blue-500">Uploading...</span>}
      {uploadError && <span className="text-xs text-red-500">{uploadError}</span>}
    </div>
  );
}

/* ================================================================
   SourcedUnitSection
   Field mapping (no new DB columns needed):
     seller_name        → Source Dealership
     vehicle_paid       → Payment Status
     payment_method     → Wire / Draft / E-Transfer / CC
     drivers_booked_for_pickup → Transport Booked
     pickup_company     → Transport Type  (Drivers | Transport Truck)
     pickup_driver_names→ Driver Name(s)
     pickup_datetime    → Pickup Date & Time
     comes_with_safety  → Safetied / As Is
     picked_up_delivered→ Landed on Lot
================================================================ */

export default function SourcedUnitSection({ dealId, editing }) {
  const [data, setData]       = useState(null);
  const [form, setForm]       = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const res  = await fetch(`${API_URL}/sourced-units/${dealId}`);
      if (!res.ok) throw new Error('Failed to fetch sourced unit');
      const json = await res.json();
      setData(json); setForm(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    const ch = supabase
      .channel(`sourced-unit-${dealId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'sourced_units', filter: `deal_id=eq.${dealId}` },
        fetchData)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [dealId, fetchData]);

  useEffect(() => { if (!editing && data) setForm(data); }, [editing, data]);

  const handleChange = e => {
    const { name, value, type, checked } = e.target;
    setForm(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleSave = async () => {
    setSaving(true); setError(null);
    try {
      const res = await fetch(`${API_URL}/sourced-units/${dealId}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          ...form,
          deposit_premium_paid: form.deposit_premium_paid,
          deposit_amount: form.deposit_amount ? parseFloat(form.deposit_amount) : 0,
          deposit_payment_method: form.deposit_payment_method || null,
          deposit_receipt_url: form.deposit_receipt_url || null,
        }),
      });
      if (!res.ok) throw new Error('Failed to save sourced unit');
      const updated = await res.json();
      setData(updated); setForm(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  /* ---------- transport type label helper ---------- */
  const transportLabel = v =>
    v === 'transport_truck' ? 'Transport Truck'
    : v === 'drivers'       ? 'Drivers'
    : v || '—';

  const paymentLabel = v =>
    v === 'wire'      ? 'Wire Transfer'
    : v === 'draft'   ? 'Bank Draft'
    : v === 'etransfer' ? 'E-Transfer'
    : v === 'cc'      ? 'Credit Card'
    : v || '—';

  if (loading) return (
    <div className="flex items-center justify-center py-8">
      <div className="h-6 w-6 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600" />
    </div>
  );

  if (error && !data) return <div className="text-red-600 text-sm p-4">{error}</div>;

  /* ================================================ READ-ONLY VIEW */
  if (!editing) return (
    <div className="space-y-3">

      {/* 1 · Source Dealership */}
      <SectionCard title="Source Dealership" icon="">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ReadField label="Dealership Name" value={form.seller_name} />
          <ReadField label="Location"        value={form.seller_location} />
        </div>
      </SectionCard>

      {/* 2 · Payment */}
      <SectionCard title="Payment" icon="">
        <div className="flex items-center gap-3 flex-wrap">
          <StatusPill value={form.vehicle_paid} trueLabel="PAID" falseLabel="NOT PAID" />
          {form.vehicle_paid && (
            <span className="text-sm font-semibold text-gray-700">
              via {paymentLabel(form.payment_method)}
            </span>
          )}
        </div>
      </SectionCard>

      {/* 3 · Transport */}
      <SectionCard title="Transport" icon="">
        <div className="flex items-center gap-3 flex-wrap">
          <StatusPill value={form.drivers_booked_for_pickup} trueLabel="TRANSPORT BOOKED" falseLabel="NOT BOOKED" />
          {form.drivers_booked_for_pickup && (
            <span className="text-sm font-semibold text-gray-700">
              {transportLabel(form.pickup_company)}
            </span>
          )}
        </div>
        {form.drivers_booked_for_pickup && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2 pl-4 border-l-2 border-blue-200">
            {form.pickup_driver_names && <ReadField label="Driver Name(s)" value={form.pickup_driver_names} />}
            {form.pickup_datetime && <ReadField label="Pickup Date & Time" value={new Date(form.pickup_datetime).toLocaleString()} />}
          </div>
        )}
      </SectionCard>

      {/* 4 · Safety + Lot Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <SectionCard title="Safety Condition" icon="">
          {form.comes_with_safety
            ? <StatusPill value={true}  trueLabel="COMES SAFETIED" falseLabel="" />
            : <StatusPill value={false} trueLabel="" falseLabel="AS IS" />
          }
        </SectionCard>

        <SectionCard title="Lot Status" icon="" highlight={form.picked_up_delivered}>
          <StatusPill
            value={form.picked_up_delivered}
            trueLabel="LANDED ON LOT"
            falseLabel="NOT ON LOT YET"
          />
        </SectionCard>
      </div>

      {/* DEPOSIT SECTION - READ ONLY */}
      <SectionCard title="Deposit" icon="">
        <div className="flex items-center gap-3 flex-wrap">
          <StatusPill
            value={form.deposit_premium_paid}
            trueLabel="DEPOSIT PAID"
            falseLabel="NO DEPOSIT"
          />
          {form.deposit_premium_paid && form.deposit_amount > 0 && (
            <span className="text-sm font-semibold text-gray-700">
              ${parseFloat(form.deposit_amount).toLocaleString('en-CA', { minimumFractionDigits: 2 })}
            </span>
          )}
          {form.deposit_premium_paid && form.deposit_payment_method && (
            <span className="text-sm text-gray-600">
              via {form.deposit_payment_method === 'cc' ? 'Credit Card' : 'E-Transfer'}
            </span>
          )}
        </div>
        {form.deposit_receipt_url && (
          <a href={form.deposit_receipt_url} target="_blank" rel="noreferrer"
             className="mt-2 inline-flex items-center gap-1 text-sm text-blue-600 underline">
            View Receipt
          </a>
        )}
      </SectionCard>

      {/* Bill of Sale */}
      <SectionCard title="Bill of Sale" icon="">
        <div className="flex items-center gap-3 flex-wrap">
          <StatusPill value={form.bill_of_sale_received} trueLabel="RECEIVED" falseLabel="PENDING" />
        </div>
        {form.bill_of_sale_url && (
          <div className="mt-2">
            <FileUpload dealId={dealId} category="bill-of-sale" currentUrl={form.bill_of_sale_url}
              onUploadComplete={() => {}} onDeleteComplete={() => {}} disabled />
          </div>
        )}
      </SectionCard>

    </div>
  );

  /* ================================================ EDIT VIEW */
  return (
    <div className="space-y-5">

      {/* 1 · Source Dealership */}
      <SectionCard title="Source Dealership" icon="">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <TextField label="Dealership Name" name="seller_name"
            value={form.seller_name} onChange={handleChange}
            placeholder="e.g. ABC Honda Ottawa" />
          <TextField label="Location (City / Province)" name="seller_location"
            value={form.seller_location} onChange={handleChange}
            placeholder="e.g. Ottawa, ON" />
        </div>
      </SectionCard>

      {/* 2 · Payment */}
      <SectionCard title="Payment" icon="">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ToggleButtons label="Payment Status" name="vehicle_paid"
            value={form.vehicle_paid} onChange={handleChange}
            trueLabel="PAID" falseLabel="NOT PAID" />
          <SelectField label="Payment Method" name="payment_method"
            value={form.payment_method} onChange={handleChange}
            options={[
              { value: '',          label: '— Select Method —' },
              { value: 'wire',      label: 'Wire Transfer' },
              { value: 'draft',     label: 'Bank Draft' },
              { value: 'etransfer', label: 'E-Transfer' },
              { value: 'cc',        label: 'Credit Card' },
            ]} />
        </div>
      </SectionCard>

      {/* 3 · Transport */}
      <SectionCard title="Transport" icon="">
        <div className="flex items-center gap-2">
          <input type="checkbox" id="transport_booked" name="drivers_booked_for_pickup"
            checked={form.drivers_booked_for_pickup ?? false} onChange={handleChange}
            className="h-4 w-4 rounded border-gray-300 text-blue-600" />
          <label htmlFor="transport_booked" className="text-sm font-medium text-gray-700">
            Transport Booked for Pickup
          </label>
        </div>
        {form.drivers_booked_for_pickup && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pl-4 border-l-2 border-blue-200">
            <SelectField label="Transport Type" name="pickup_company"
              value={form.pickup_company} onChange={handleChange}
              options={[
                { value: '',               label: '— Select Type —' },
                { value: 'drivers',        label: 'Drivers' },
                { value: 'transport_truck',label: 'Transport Truck' },
              ]} />
            <TextField label="Driver Name(s)" name="pickup_driver_names"
              value={form.pickup_driver_names} onChange={handleChange}
              placeholder="Driver names" />
            <TextField label="Pickup Date & Time" name="pickup_datetime"
              type="datetime-local" value={form.pickup_datetime} onChange={handleChange} />
          </div>
        )}
      </SectionCard>

      {/* 4 · Safety + Lot Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SectionCard title="Safety Condition" icon="">
          <ToggleButtons name="comes_with_safety"
            value={form.comes_with_safety} onChange={handleChange}
            trueLabel="Comes Safetied" falseLabel="As Is" />
        </SectionCard>

        <SectionCard title="Lot Status" icon="" highlight={form.picked_up_delivered}>
          <ToggleButtons name="picked_up_delivered"
            value={form.picked_up_delivered} onChange={handleChange}
            trueLabel="Landed on Lot" falseLabel="In Transit" />
        </SectionCard>
      </div>

      {/* DEPOSIT SECTION - EDIT */}
      <div className="border rounded-lg p-4 bg-gray-50 flex flex-col gap-3">
        <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Deposit</h3>

        <ToggleButtons
          label="Deposit Paid?"
          name="deposit_premium_paid"
          value={form.deposit_premium_paid}
          trueLabel="Paid"
          falseLabel="Not Paid"
          onChange={handleChange}
        />

        {form.deposit_premium_paid && (
          <>
            <TextField
              label="Deposit Amount ($)"
              name="deposit_amount"
              value={form.deposit_amount}
              onChange={handleChange}
              type="number"
            />

            <SelectField
              label="How Was It Paid?"
              name="deposit_payment_method"
              value={form.deposit_payment_method}
              onChange={handleChange}
              options={[
                { value: '', label: '— Select —' },
                { value: 'cc', label: 'Credit Card' },
                { value: 'etransfer', label: 'E-Transfer' },
              ]}
            />

            <FileUploadField
              label="Upload Receipt"
              name="deposit_receipt_url"
              value={form.deposit_receipt_url}
              onChange={handleChange}
            />
          </>
        )}
      </div>

      {/* 6 · Bill of Sale */}
      <SectionCard title="Bill of Sale" icon="">
        <div className="flex items-center gap-2 mb-3">
          <input type="checkbox" id="bos_received" name="bill_of_sale_received"
            checked={form.bill_of_sale_received ?? false} onChange={handleChange}
            className="h-4 w-4 rounded border-gray-300 text-blue-600" />
          <label htmlFor="bos_received" className="text-sm font-medium text-gray-700">
            Bill of Sale Received
          </label>
        </div>
        <FileUpload dealId={dealId} category="bill-of-sale" currentUrl={form.bill_of_sale_url}
          onUploadComplete={url => setForm(p => ({ ...p, bill_of_sale_url: url }))}
          onDeleteComplete={() => setForm(p => ({ ...p, bill_of_sale_url: null }))} />
      </SectionCard>

      {/* Save */}
      <div className="flex items-center gap-3 pt-2">
        <button type="button" onClick={handleSave} disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm
            font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {saving && (
            <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
            </svg>
          )}
          {saving ? 'Saving...' : 'Save Sourced Unit Info'}
        </button>
        {error && <span className="text-red-500 text-sm">{error}</span>}
      </div>

    </div>
  );
}
