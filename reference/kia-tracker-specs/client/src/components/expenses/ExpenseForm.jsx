import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Save, Upload as UploadIcon, Loader2, ExternalLink } from 'lucide-react';
import SupplierSelector from './SupplierSelector';
import { supabase } from '../../supabaseClient';

const RECEIPTS_BUCKET = 'expense-receipts';
const API_URL = import.meta.env.VITE_API_URL;

// Tax presets. Each rate is applied to the pre-tax amount.
// "custom" means "user types whatever they want; don't auto-calc".
const TAX_MODES = [
  { code: 'qc',     label: 'GST + QST (QC) — 14.975%', rate: 0.14975 },
  { code: 'on',     label: 'HST (ON) — 13%',           rate: 0.13 },
  { code: 'atl',    label: 'HST (NB/NL/NS/PE) — 15%',  rate: 0.15 },
  { code: 'bc',     label: 'GST + PST (BC) — 12%',     rate: 0.12 },
  { code: 'sk',     label: 'GST + PST (SK) — 11%',     rate: 0.11 },
  { code: 'mb',     label: 'GST + PST (MB) — 12%',     rate: 0.12 },
  { code: 'gst',    label: 'GST only — 5%',            rate: 0.05 },
  { code: 'none',   label: 'No tax',                   rate: 0.00 },
  { code: 'custom', label: 'Custom (enter manually)',  rate: null },
];

function computeTax(amountStr, rate) {
  const amt = Number(amountStr);
  if (!isFinite(amt) || rate == null) return null;
  return (amt * rate).toFixed(2);
}

// Try to infer the mode from an existing expense (edit case) by matching rate.
function inferMode(amountCents, taxCents) {
  if (!amountCents) return 'qc';
  if (!taxCents) return 'none';
  const rate = taxCents / amountCents;
  let best = null;
  let bestDelta = 0.0025;
  for (const m of TAX_MODES) {
    if (m.rate == null) continue;
    const d = Math.abs(rate - m.rate);
    if (d < bestDelta) { bestDelta = d; best = m.code; }
  }
  return best || 'custom';
}

export default function ExpenseForm({ initial, inventoryId, dealId, stockNumber, currentUserId, onClose, onSaved }) {
  const isEdit = !!initial?.id;

  const [form, setForm] = useState(() => ({
    category_code: initial?.category_code || 'recon',
    supplier:      initial?.supplier || null,
    supplier_name: initial?.supplier_name || '',
    amount:        initial ? ((initial.amount_cents || 0) / 100).toFixed(2) : '',
    tax:           initial ? ((initial.tax_cents || 0) / 100).toFixed(2) : '0.00',
    invoice_number: initial?.invoice_number || '',
    expense_date:  initial?.expense_date || new Date().toISOString().slice(0, 10),
    description:   initial?.description || '',
    notes:         initial?.notes || '',
    receipt_url:   initial?.receipt_url || '',
    payment_method: initial?.payment_method || '',
  }));

  const [taxMode, setTaxMode] = useState(() =>
    isEdit ? inferMode(initial.amount_cents, initial.tax_cents) : 'qc'
  );

  useEffect(() => { if (!initial) setForm((f) => ({ ...f })); }, [initial]);

  // Auto-recalculate tax when amount or mode changes (except in custom mode).
  useEffect(() => {
    const mode = TAX_MODES.find((m) => m.code === taxMode);
    if (!mode || mode.rate == null) return;
    const next = computeTax(form.amount, mode.rate);
    if (next == null) return;
    setForm((f) => (f.tax === next ? f : { ...f, tax: next }));
  }, [form.amount, taxMode]);

  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState(null);

  const handleFile = async (file) => {
    if (!file) return;
    setUploading(true);
    setUploadErr(null);
    try {
      const ext = file.name.split('.').pop() || 'bin';
      const path = `${inventoryId || dealId || stockNumber || 'unassigned'}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(RECEIPTS_BUCKET)
        .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from(RECEIPTS_BUCKET).getPublicUrl(path);
      setForm((f) => ({ ...f, receipt_url: data?.publicUrl || '' }));
    } catch (err) {
      setUploadErr(err?.message || 'Upload failed. Make sure the "expense-receipts" bucket exists.');
    } finally {
      setUploading(false);
    }
  };

  const { data: categories = [] } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: async () => {
      const r = await fetch(`${API_URL}/expenses/categories`);
      if (!r.ok) return [];
      return r.json();
    },
  });

  // If the current category_code isn't in the loaded list, fall back to the first one.
  useEffect(() => {
    if (!categories.length) return;
    const valid = categories.some((c) => c.code === form.category_code);
    if (!valid) setForm((f) => ({ ...f, category_code: categories[0].code }));
  }, [categories]);

  // Auto-fill category and tax from supplier defaults when supplier is picked.
  // Only fills category when the user hasn't explicitly chosen one yet.
  useEffect(() => {
    const supplier = form.supplier;
    if (!supplier) return;
    setForm((f) => {
      const next = { ...f };
      if (!f.category_code && supplier.default_expense_type) {
        next.category_code = supplier.default_expense_type;
      }
      return next;
    });
    if (supplier.tax_exempt) {
      setTaxMode('none');
    }
  }, [form.supplier?.id]);

  const submit = async (e) => {
    e.preventDefault();
    const payload = {
      inventory_id: inventoryId || null,
      deal_id: dealId || null,
      stock_number: stockNumber || null,
      category_code: form.category_code,
      supplier_id: form.supplier?.id || null,
      supplier_name: form.supplier?.name || form.supplier_name || null,
      amount_cents: Math.round(Number(form.amount) * 100),
      tax_cents: Math.round(Number(form.tax) * 100),
      invoice_number: form.invoice_number || null,
      expense_date: form.expense_date,
      description: form.description || null,
      notes: form.notes || null,
      receipt_url: form.receipt_url || null,
      payment_method: form.payment_method || null,
      created_by: currentUserId || null,
      tax_mode: taxMode,
    };

    const url = isEdit ? `${API_URL}/expenses/${initial.id}` : `${API_URL}/expenses`;
    const method = isEdit ? 'PUT' : 'POST';
    const r = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      alert(err.error || 'Failed to save expense');
      return;
    }
    onSaved?.();
  };

  const activeRate = useMemo(
    () => TAX_MODES.find((m) => m.code === taxMode)?.rate,
    [taxMode]
  );
  const taxIsAuto = activeRate != null;

  return (
    <div className="fixed inset-0 z-[65] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white rounded-xl shadow-2xl w-full max-w-lg ring-1 ring-black/5 overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-red-600 to-red-400" />
        <header className="flex items-center justify-between px-5 py-3 bg-gradient-to-r from-gray-800 to-gray-900 text-white">
          <h2 className="text-sm font-bold">{isEdit ? 'Edit Expense' : 'Add Expense'}</h2>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-white/20"><X size={16} /></button>
        </header>

        <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Category *</label>
              <select
                value={form.category_code}
                onChange={(e) => setForm({ ...form, category_code: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500/30"
              >
                {categories.map((c) => (
                  <option key={c.code} value={c.code}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Date *</label>
              <input
                type="date"
                value={form.expense_date}
                onChange={(e) => setForm({ ...form, expense_date: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500/30"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Supplier</label>
            <SupplierSelector value={form.supplier} onChange={(s) => setForm({ ...form, supplier: s, supplier_name: s?.name || '' })} expenseCategories={categories} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Amount (pre-tax) *</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                <input
                  type="number" step="0.01" required
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500/30 tabular-nums"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Tax Mode</label>
              <select
                value={taxMode}
                onChange={(e) => setTaxMode(e.target.value)}
                disabled={!!form.supplier?.tax_exempt}
                className={`w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500/30 ${form.supplier?.tax_exempt ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : ''}`}
              >
                {TAX_MODES.map((m) => (
                  <option key={m.code} value={m.code}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              Tax {taxIsAuto ? <span className="font-normal text-gray-400">(auto-calculated)</span> : <span className="font-normal text-gray-400">(manual)</span>}
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
              <input
                type="number" step="0.01"
                value={form.tax}
                readOnly={taxIsAuto || !!form.supplier?.tax_exempt}
                disabled={!!form.supplier?.tax_exempt}
                onChange={(e) => setForm({ ...form, tax: e.target.value })}
                className={`w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500/30 tabular-nums ${taxIsAuto || form.supplier?.tax_exempt ? 'bg-gray-50 text-gray-700 cursor-not-allowed' : ''}`}
              />
            </div>
            {form.supplier?.tax_exempt && (
              <p className="text-[11px] text-gray-500 mt-1">This supplier is marked Tax Exempt — tax is locked at 0.</p>
            )}
            {!form.supplier?.tax_exempt && taxIsAuto && Number(form.amount) > 0 && (
              <div className="mt-1 text-[11px] text-gray-500">
                {(activeRate * 100).toFixed(3).replace(/\.?0+$/, '')}% of ${Number(form.amount).toFixed(2)} = ${form.tax}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Invoice #</label>
              <input
                value={form.invoice_number}
                onChange={(e) => setForm({ ...form, invoice_number: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Payment Method</label>
              <select
                value={form.payment_method}
                onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                <option value="">—</option>
                <option value="cash">Cash</option>
                <option value="cheque">Cheque</option>
                <option value="etransfer">E-Transfer</option>
                <option value="credit">Credit Card</option>
                <option value="ap">A/P (invoiced)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Description</label>
            <input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Brief description of the expense"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Receipt</label>
            <div className="flex items-center gap-2">
              <label className={`inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold rounded-lg cursor-pointer transition-all ${uploading ? 'bg-gray-200 text-gray-500' : 'bg-gray-800 hover:bg-gray-900 text-white'}`}>
                {uploading ? <Loader2 size={12} className="animate-spin" /> : <UploadIcon size={12} />}
                {uploading ? 'Uploading…' : 'Upload file'}
                <input
                  type="file" accept="image/*,application/pdf"
                  disabled={uploading}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
                  className="hidden"
                />
              </label>
              <input
                value={form.receipt_url}
                onChange={(e) => setForm({ ...form, receipt_url: e.target.value })}
                placeholder="or paste URL"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
              {form.receipt_url && (
                <a href={form.receipt_url} target="_blank" rel="noreferrer" className="p-2 text-gray-500 hover:text-gray-800">
                  <ExternalLink size={14} />
                </a>
              )}
            </div>
            {uploadErr && <div className="mt-1 text-xs text-red-600">{uploadErr}</div>}
          </div>
        </div>

        <footer className="px-5 py-3 border-t border-gray-200 bg-gray-50 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 hover:bg-white rounded-lg">Cancel</button>
          <button type="submit" className="inline-flex items-center gap-1 px-4 py-2 text-sm font-semibold bg-gradient-to-r from-red-600 to-red-500 hover:from-red-700 hover:to-red-600 text-white rounded-lg shadow-sm">
            <Save size={14} /> {isEdit ? 'Save changes' : 'Create expense'}
          </button>
        </footer>
      </form>
    </div>
  );
}
