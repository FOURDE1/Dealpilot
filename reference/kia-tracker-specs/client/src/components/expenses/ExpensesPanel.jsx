import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, CheckCircle2, XCircle, DollarSign, Trash2, Edit2, Receipt, Upload, Printer } from 'lucide-react';
import SupplierSelector from './SupplierSelector';
import ExpenseForm from './ExpenseForm';
import MultipleExpensesModal from './MultipleExpensesModal';

const API_URL = import.meta.env.VITE_API_URL;

const STATUS_STYLES = {
  pending:  'bg-amber-100 text-amber-800',
  approved: 'bg-blue-100 text-blue-800',
  paid:     'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
  void:     'bg-gray-100 text-gray-500',
};

const lineCents = (e) => (e?.amount_cents ?? 0) + (e?.tax_cents ?? 0);

function money(cents) {
  const n = Number(cents) || 0;
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(n / 100);
}

/**
 * Reusable expenses panel. Pass one of:
 *   inventoryId  — binds expenses to a stock unit
 *   dealId       — binds expenses to a deal
 *   stockNumber  — loose binding (display-only, can still add)
 * isManager controls approval button visibility.
 */
export default function ExpensesPanel({ inventoryId, dealId, stockNumber, isManager = false, currentUserId, vehicle = null }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(null); // { id?, ...row } or 'new'
  const [showForm, setShowForm] = useState(false);
  const [multiOpen, setMultiOpen] = useState(false);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (inventoryId) p.set('inventory_id', inventoryId);
    if (dealId) p.set('deal_id', dealId);
    if (!inventoryId && !dealId && stockNumber) p.set('stock_number', stockNumber);
    return p.toString();
  }, [inventoryId, dealId, stockNumber]);

  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ['expenses', params],
    queryFn: async () => {
      const r = await fetch(`${API_URL}/expenses?${params}`);
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!params,
  });

  const { data: categoriesList = [] } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: async () => {
      const r = await fetch(`${API_URL}/expenses/categories`);
      if (!r.ok) return [];
      return r.json();
    },
  });

  const totals = useMemo(() => {
    let t = 0, pending = 0, paid = 0;
    for (const e of expenses) {
      if (e.status === 'void' || e.status === 'rejected') continue;
      const c = lineCents(e);
      t += c;
      if (e.status === 'pending') pending += c;
      if (e.status === 'paid') paid += c;
    }
    return { t, pending, paid };
  }, [expenses]);

  const approve = useMutation({
    mutationFn: async (id) => {
      const r = await fetch(`${API_URL}/expenses/${id}/approve`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved_by: currentUserId }),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'approve failed');
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expenses'] }),
  });

  const reject = useMutation({
    mutationFn: async (id) => {
      const r = await fetch(`${API_URL}/expenses/${id}/reject`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved_by: currentUserId }),
      });
      if (!r.ok) throw new Error('reject failed');
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expenses'] }),
  });

  const markPaid = useMutation({
    mutationFn: async (id) => {
      const r = await fetch(`${API_URL}/expenses/${id}/pay`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!r.ok) throw new Error('pay failed');
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expenses'] }),
  });

  const voidExp = useMutation({
    mutationFn: async (id) => {
      const r = await fetch(`${API_URL}/expenses/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('void failed');
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expenses'] }),
  });

  const handlePrint = () => {
    const catLabel = (code) =>
      categoriesList.find((c) => c.code === code)?.label || code || "";

    const visible = expenses.filter(
      (e) => e.status !== "void" && e.status !== "rejected"
    );

    const totalCents = visible.reduce((s, e) => s + lineCents(e), 0);

    const rowsHtml = visible
      .map((e) => {
        const amt = lineCents(e);
        return `
          <tr>
            <td>${e.expense_date || ""}</td>
            <td>${(e.supplier_name || "").replace(/</g, "&lt;")}</td>
            <td>${(e.invoice_number || "").replace(/</g, "&lt;")}</td>
            <td>${catLabel(e.category_code).replace(/</g, "&lt;")}</td>
            <td>${(e.description || "").replace(/</g, "&lt;")}</td>
            <td class="num">${money(amt)}</td>
          </tr>`;
      })
      .join("");

    const vehicleLine = vehicle
      ? `${vehicle.year || ""} ${vehicle.make || ""} ${vehicle.model || ""}${
          vehicle.trim ? " " + vehicle.trim : ""
        }`.trim()
      : "";
    const vinLine = vehicle?.vin || "";

    const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Expense List — Stock #${stockNumber || ""}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #111; margin: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .sub { color: #555; font-size: 12px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { padding: 6px 8px; border-bottom: 1px solid #ddd; text-align: left; vertical-align: top; }
  thead th { background: #f3f4f6; font-weight: 600; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tfoot td { font-weight: 700; border-top: 2px solid #111; border-bottom: none; padding-top: 10px; }
  .meta { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 12px; }
  .meta .right { text-align: right; font-size: 11px; color: #555; }
  @media print {
    body { margin: 12mm; }
    @page { margin: 12mm; }
  }
</style>
</head>
<body>
  <div class="meta">
    <div>
      <h1>Expense List for Stock #${stockNumber || "—"}</h1>
      <div class="sub">${vehicleLine ? vehicleLine + (vinLine ? " · VIN " + vinLine : "") : ""}</div>
    </div>
    <div class="right">
      <div>Kia Mont-Laurier</div>
      <div>Generated ${new Date().toLocaleString("en-CA")}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Supplier</th>
        <th>Invoice #</th>
        <th>Expense Type</th>
        <th>Particulars</th>
        <th class="num">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml || '<tr><td colspan="6" style="text-align:center;color:#888;padding:20px;">No expenses to print.</td></tr>'}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="5" style="text-align:right;">Total</td>
        <td class="num">${money(totalCents)}</td>
      </tr>
    </tfoot>
  </table>

  <script>
    window.addEventListener('load', () => { setTimeout(() => window.print(), 300); });
  </script>
</body>
</html>`;

    const w = window.open("", "_blank");
    if (!w) {
      alert("Popup blocked. Please allow popups for this site to print.");
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
            <Receipt size={18} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900">Expenses</h3>
            <p className="text-xs text-gray-500">{expenses.length} {expenses.length === 1 ? 'entry' : 'entries'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrint}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-amber-400 hover:bg-amber-500 text-gray-900 rounded-lg shadow-sm transition-all"
            title="Print expense list"
          >
            <Printer size={14} /> Print
          </button>
          <button
            onClick={() => setMultiOpen(true)}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold border border-amber-500 text-amber-700 hover:bg-amber-50 rounded-lg transition-all"
          >
            <Plus size={14} /> Multiple
          </button>
          <button
            onClick={() => { setEditing('new'); setShowForm(true); }}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-gradient-to-r from-red-600 to-red-500 hover:from-red-700 hover:to-red-600 text-white rounded-lg shadow-sm hover:shadow-md transition-all"
          >
            <Plus size={14} /> Add Expense
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="bg-gray-50 rounded-lg p-2 text-center">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Total</div>
          <div className="text-sm font-bold text-gray-900 tabular-nums">{money(totals.t)}</div>
        </div>
        <div className="bg-amber-50 rounded-lg p-2 text-center">
          <div className="text-[10px] uppercase tracking-wider text-amber-700">Pending</div>
          <div className="text-sm font-bold text-amber-800 tabular-nums">{money(totals.pending)}</div>
        </div>
        <div className="bg-emerald-50 rounded-lg p-2 text-center">
          <div className="text-[10px] uppercase tracking-wider text-emerald-700">Paid</div>
          <div className="text-sm font-bold text-emerald-800 tabular-nums">{money(totals.paid)}</div>
        </div>
      </div>

      {isLoading ? (
        <div className="text-xs text-gray-400 italic text-center py-4">Loading…</div>
      ) : expenses.length === 0 ? (
        <div className="text-xs text-gray-400 italic text-center py-6">No expenses yet. Click "Add Expense" to record one.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
                <th className="py-2 pr-2 text-left">Date</th>
                <th className="py-2 pr-2 text-left">Category</th>
                <th className="py-2 pr-2 text-left">Supplier</th>
                <th className="py-2 pr-2 text-left">Invoice #</th>
                <th className="py-2 pr-2 text-right">Amount</th>
                <th className="py-2 pr-2 text-center">Status</th>
                <th className="py-2 pr-2"></th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50">
                  <td className="py-2 pr-2 whitespace-nowrap text-gray-600">{e.expense_date}</td>
                  <td className="py-2 pr-2 text-gray-700">{e.category?.label || e.category_code}</td>
                  <td className="py-2 pr-2 text-gray-700 max-w-[140px] truncate">{e.supplier?.name || e.supplier_name || '—'}</td>
                  <td className="py-2 pr-2 text-gray-600 font-mono text-[11px]">{e.invoice_number || '—'}</td>
                  <td className="py-2 pr-2 text-right font-semibold text-gray-900 tabular-nums">{money(lineCents(e))}</td>
                  <td className="py-2 pr-2 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${STATUS_STYLES[e.status] || ''}`}>
                      {e.status}
                    </span>
                  </td>
                  <td className="py-2 pr-2 text-right">
                    <div className="inline-flex items-center gap-1">
                      {isManager && e.status === 'pending' && (
                        <>
                          <button onClick={() => approve.mutate(e.id)} title="Approve" className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"><CheckCircle2 size={14} /></button>
                          <button onClick={() => reject.mutate(e.id)} title="Reject" className="p-1 text-red-600 hover:bg-red-50 rounded"><XCircle size={14} /></button>
                        </>
                      )}
                      {isManager && e.status === 'approved' && (
                        <button onClick={() => markPaid.mutate(e.id)} title="Mark paid" className="p-1 text-emerald-700 hover:bg-emerald-50 rounded"><DollarSign size={14} /></button>
                      )}
                      {e.receipt_url && (
                        <a href={e.receipt_url} target="_blank" rel="noreferrer" title="Receipt" className="p-1 text-gray-500 hover:bg-gray-100 rounded"><Upload size={14} /></a>
                      )}
                      <button onClick={() => { setEditing(e); setShowForm(true); }} title="Edit" className="p-1 text-gray-500 hover:bg-gray-100 rounded"><Edit2 size={14} /></button>
                      {e.status !== 'void' && (
                        <button onClick={() => { if (confirm('Void this expense?')) voidExp.mutate(e.id); }} title="Void" className="p-1 text-red-500 hover:bg-red-50 rounded"><Trash2 size={14} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t font-bold">
                <td colSpan={4} className="py-2 pr-2 text-right">Total</td>
                <td className="py-2 pr-2 text-right tabular-nums">{money(totals.t)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {showForm && (
        <ExpenseForm
          initial={editing === 'new' ? null : editing}
          inventoryId={inventoryId}
          dealId={dealId}
          stockNumber={stockNumber}
          currentUserId={currentUserId}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); qc.invalidateQueries({ queryKey: ['expenses'] }); }}
        />
      )}

      {multiOpen && (
        <MultipleExpensesModal
          inventoryId={inventoryId}
          dealId={dealId}
          stockNumber={stockNumber}
          currentUserId={currentUserId}
          onClose={() => setMultiOpen(false)}
          onSaved={() => qc.invalidateQueries({ queryKey: ['expenses'] })}
        />
      )}
    </div>
  );
}
