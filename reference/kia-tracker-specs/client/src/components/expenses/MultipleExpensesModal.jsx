import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, Plus, Trash2, CheckCircle2, XCircle, Loader2 } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL;

const TAX_MODES = [
  { code: "qc", label: "QC 14.975%", rate: 0.14975 },
  { code: "on", label: "ON 13%", rate: 0.13 },
  { code: "atl", label: "ATL 15%", rate: 0.15 },
  { code: "bc", label: "BC 12%", rate: 0.12 },
  { code: "gst", label: "GST 5%", rate: 0.05 },
  { code: "none", label: "No tax", rate: 0 },
  { code: "custom", label: "Custom", rate: null },
];

const today = () => new Date().toISOString().slice(0, 10);

const blankRow = (defaultCat) => ({
  expense_date: today(),
  category_code: defaultCat || "recon",
  supplier_id: "",
  amount: "",
  tax_mode: "qc",
  tax: "",
  invoice_number: "",
  description: "",
});

function computeTax(amount, mode) {
  const m = TAX_MODES.find((x) => x.code === mode);
  if (!m || m.rate == null) return null;
  const a = Number(amount);
  if (!isFinite(a)) return null;
  return (a * m.rate).toFixed(2);
}

export default function MultipleExpensesModal({
  inventoryId,
  dealId,
  stockNumber,
  currentUserId,
  onClose,
  onSaved,
}) {
  const { data: categories = [] } = useQuery({
    queryKey: ["expense-categories"],
    queryFn: async () => {
      const r = await fetch(`${API_URL}/expenses/categories`);
      if (!r.ok) return [];
      return r.json();
    },
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers", "active"],
    queryFn: async () => {
      const r = await fetch(`${API_URL}/suppliers`);
      if (!r.ok) return [];
      return r.json();
    },
  });

  const defaultCat = categories[0]?.code;
  const [rows, setRows] = useState(() =>
    Array.from({ length: 5 }, () => blankRow(defaultCat))
  );
  const [results, setResults] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!defaultCat) return;
    setRows((rs) =>
      rs.map((r) =>
        r.category_code && categories.some((c) => c.code === r.category_code)
          ? r
          : { ...r, category_code: defaultCat }
      )
    );
  }, [defaultCat]);

  const update = (i, patch) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const addRow = () => setRows((rs) => [...rs, blankRow(defaultCat)]);
  const removeRow = (i) => setRows((rs) => rs.filter((_, idx) => idx !== i));

  const isFilled = (r) => r.amount !== "" && Number(r.amount) > 0;

  const totals = useMemo(() => {
    let amt = 0,
      tax = 0;
    for (const r of rows) {
      if (!isFilled(r)) continue;
      amt += Number(r.amount) || 0;
      const auto = computeTax(r.amount, r.tax_mode);
      const t = auto != null ? Number(auto) : Number(r.tax) || 0;
      tax += t;
    }
    return { amt, tax, total: amt + tax };
  }, [rows]);

  const filledCount = rows.filter(isFilled).length;

  const saveAll = async () => {
    setSaving(true);
    const newResults = rows.map(() => null);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!isFilled(r)) {
        newResults[i] = { status: "skip" };
        setResults([...newResults]);
        continue;
      }
      const supplier = suppliers.find((s) => s.id === r.supplier_id);
      const autoTax = computeTax(r.amount, r.tax_mode);
      const taxValue = autoTax != null ? autoTax : r.tax;

      const payload = {
        inventory_id: inventoryId || null,
        deal_id: dealId || null,
        stock_number: stockNumber || null,
        category_code: r.category_code,
        supplier_id: r.supplier_id || null,
        supplier_name: supplier?.name || null,
        amount_cents: Math.round(Number(r.amount) * 100),
        tax_cents: Math.round(Number(taxValue || 0) * 100),
        invoice_number: r.invoice_number || null,
        expense_date: r.expense_date,
        description: r.description || null,
        notes: null,
        receipt_url: null,
        payment_method: null,
        created_by: currentUserId || null,
        tax_mode: r.tax_mode,
      };
      try {
        const resp = await fetch(`${API_URL}/expenses`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!resp.ok) {
          const e = await resp.json().catch(() => ({}));
          newResults[i] = { status: "err", message: e.error || `HTTP ${resp.status}` };
        } else {
          newResults[i] = { status: "ok" };
        }
      } catch (e) {
        newResults[i] = { status: "err", message: e.message };
      }
      setResults([...newResults]);
    }
    setSaving(false);
    const okCount = newResults.filter((r) => r?.status === "ok").length;
    if (okCount > 0) onSaved?.();
    if (okCount === filledCount && filledCount > 0) {
      setTimeout(() => onClose?.(), 800);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden">
        <header className="flex items-center justify-between px-5 py-3 bg-amber-400">
          <h2 className="text-lg font-semibold text-gray-900">
            Add Multiple Expenses{stockNumber ? ` for Stock #${stockNumber}` : ""}
          </h2>
          <button onClick={onClose} className="text-gray-700 hover:text-gray-900">
            <X size={20} />
          </button>
        </header>

        <div className="flex-1 overflow-auto p-4">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 text-gray-700">
              <tr>
                <th className="text-left px-2 py-2 w-[120px]">Date</th>
                <th className="text-left px-2 py-2 w-[150px]">Category</th>
                <th className="text-left px-2 py-2 w-[200px]">Supplier</th>
                <th className="text-right px-2 py-2 w-[100px]">Amount</th>
                <th className="text-left px-2 py-2 w-[110px]">Tax mode</th>
                <th className="text-right px-2 py-2 w-[90px]">Tax</th>
                <th className="text-left px-2 py-2 w-[110px]">Invoice #</th>
                <th className="text-left px-2 py-2">Description</th>
                <th className="w-[40px]"></th>
                <th className="w-[40px]"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const auto = computeTax(r.amount, r.tax_mode);
                const taxDisplay = auto != null ? auto : r.tax;
                const res = results[i];
                return (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="px-2 py-1">
                      <input
                        type="date"
                        value={r.expense_date}
                        onChange={(e) => update(i, { expense_date: e.target.value })}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <select
                        value={r.category_code}
                        onChange={(e) => update(i, { category_code: e.target.value })}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                      >
                        {categories.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <select
                        value={r.supplier_id}
                        onChange={(e) => update(i, { supplier_id: e.target.value })}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                      >
                        <option value="">— none —</option>
                        {suppliers.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="number"
                        step="0.01"
                        value={r.amount}
                        onChange={(e) => update(i, { amount: e.target.value })}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-xs text-right tabular-nums"
                        placeholder="0.00"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <select
                        value={r.tax_mode}
                        onChange={(e) => update(i, { tax_mode: e.target.value })}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                      >
                        {TAX_MODES.map((m) => (
                          <option key={m.code} value={m.code}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="number"
                        step="0.01"
                        value={taxDisplay}
                        disabled={auto != null}
                        onChange={(e) => update(i, { tax: e.target.value })}
                        className={`w-full px-2 py-1 border border-gray-300 rounded text-xs text-right tabular-nums ${
                          auto != null ? "bg-gray-50 text-gray-500" : ""
                        }`}
                        placeholder="0.00"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="text"
                        value={r.invoice_number}
                        onChange={(e) => update(i, { invoice_number: e.target.value })}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="text"
                        value={r.description}
                        onChange={(e) => update(i, { description: e.target.value })}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                      />
                    </td>
                    <td className="px-2 py-1 text-center">
                      {res?.status === "ok" && (
                        <CheckCircle2 size={16} className="text-green-600 inline" />
                      )}
                      {res?.status === "err" && (
                        <span title={res.message}>
                          <XCircle size={16} className="text-red-600 inline" />
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-center">
                      <button
                        type="button"
                        onClick={() => removeRow(i)}
                        className="text-gray-400 hover:text-red-600"
                        title="Remove row"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <button
            type="button"
            onClick={addRow}
            className="mt-3 inline-flex items-center gap-1 px-3 py-1 text-xs text-amber-700 hover:text-amber-900 font-medium"
          >
            <Plus size={14} /> Add row
          </button>
        </div>

        <footer className="flex items-center justify-between px-5 py-3 bg-gray-50 border-t border-gray-200">
          <div className="text-xs text-gray-600">
            <span className="mr-4">
              <span className="font-semibold">{filledCount}</span> filled row
              {filledCount === 1 ? "" : "s"}
            </span>
            <span className="mr-4">
              Subtotal:{" "}
              <span className="font-semibold tabular-nums">
                ${totals.amt.toFixed(2)}
              </span>
            </span>
            <span className="mr-4">
              Tax:{" "}
              <span className="font-semibold tabular-nums">
                ${totals.tax.toFixed(2)}
              </span>
            </span>
            <span>
              Total:{" "}
              <span className="font-bold tabular-nums">
                ${totals.total.toFixed(2)}
              </span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveAll}
              disabled={saving || filledCount === 0}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-amber-500 hover:bg-amber-600 disabled:bg-gray-300 text-white rounded-lg shadow-sm"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {saving ? "Saving\u2026" : `Save all (${filledCount})`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
