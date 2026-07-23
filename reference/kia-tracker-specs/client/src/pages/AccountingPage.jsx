import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Calculator, Receipt, TrendingUp, Clock, Building2, FileText, Download, BookOpen, Users, Percent } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL;

function money(cents) {
  const n = Number(cents) || 0;
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(n / 100);
}

function Tab({ active, onClick, icon: Icon, children }) {
  return (
    <button onClick={onClick}
      className={`relative inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all ${
        active ? 'text-red-600 font-bold' : 'text-gray-500 hover:text-gray-800'
      }`}>
      <Icon size={14} /> {children}
      {active && <span className="absolute left-3 right-3 -bottom-[2px] h-[3px] bg-gradient-to-r from-red-600 to-red-500 rounded-full" />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Reconciliation tab — all expenses within a date range + CSV export
// ---------------------------------------------------------------------------
function ReconciliationTab() {
  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = today.slice(0, 8) + '01';
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(today);
  const [status, setStatus] = useState('');
  const [groupBy, setGroupBy] = useState('category');

  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ['expenses', 'recon', from, to, status],
    queryFn: async () => {
      const p = new URLSearchParams({ from, to, limit: '2000' });
      if (status) p.set('status', status);
      const r = await fetch(`${API_URL}/expenses?${p}`);
      return r.ok ? r.json() : [];
    },
  });

  const groups = {};
  for (const e of expenses) {
    if (e.status === 'void') continue;
    const key = groupBy === 'category' ? (e.category?.label || e.category_code)
              : groupBy === 'supplier' ? (e.supplier?.name || e.supplier_name || '— no supplier —')
              : groupBy === 'stock'    ? (e.stock_number || '— unassigned —')
              : 'All';
    if (!groups[key]) groups[key] = { items: [], total: 0 };
    groups[key].items.push(e);
    groups[key].total += e.total_cents || 0;
  }
  const grandTotal = Object.values(groups).reduce((s, g) => s + g.total, 0);

  const exportCsv = () => {
    const header = ['Date', 'Stock #', 'Category', 'Supplier', 'Invoice #', 'Description', 'Amount', 'Tax', 'Total', 'Status'];
    const rows = expenses.map((e) => [
      e.expense_date, e.stock_number || '', e.category?.label || e.category_code,
      e.supplier?.name || e.supplier_name || '', e.invoice_number || '',
      (e.description || '').replace(/,/g, ';'),
      (e.amount_cents / 100).toFixed(2), (e.tax_cents / 100).toFixed(2),
      (e.total_cents / 100).toFixed(2), e.status,
    ]);
    const csv = [header, ...rows].map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `reconciliation_${from}_to_${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm">
            <option value="">All (except void)</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="paid">Paid</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Group by</label>
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm">
            <option value="category">Category</option>
            <option value="supplier">Supplier</option>
            <option value="stock">Stock #</option>
            <option value="none">None (flat)</option>
          </select>
        </div>
        <button onClick={exportCsv}
          className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 text-sm font-semibold bg-gradient-to-r from-emerald-600 to-emerald-500 text-white rounded-lg shadow-sm hover:shadow-md">
          <Download size={14} /> Export CSV
        </button>
      </div>

      {isLoading ? (
        <div className="text-center text-gray-400 italic py-8">Loading…</div>
      ) : expenses.length === 0 ? (
        <div className="text-center text-gray-400 italic py-8">No expenses in this range.</div>
      ) : (
        <div className="space-y-3">
          {Object.entries(groups).map(([key, g]) => (
            <div key={key} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-4 py-2.5 bg-gradient-to-r from-gray-50 to-white border-b border-gray-200 flex items-center justify-between">
                <span className="text-sm font-bold text-gray-800">{key}</span>
                <span className="text-sm font-bold text-gray-900 tabular-nums">{money(g.total)} · {g.items.length} entries</span>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-100">
                    <th className="py-2 px-3 text-left">Date</th>
                    <th className="py-2 px-3 text-left">Stock #</th>
                    <th className="py-2 px-3 text-left">Supplier</th>
                    <th className="py-2 px-3 text-left">Category</th>
                    <th className="py-2 px-3 text-left">Invoice</th>
                    <th className="py-2 px-3 text-right">Amount</th>
                    <th className="py-2 px-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((e) => (
                    <tr key={e.id} className="border-b border-gray-50 last:border-b-0 hover:bg-gray-50">
                      <td className="py-1.5 px-3 text-gray-600">{e.expense_date}</td>
                      <td className="py-1.5 px-3 font-mono text-[11px]">{e.stock_number || '—'}</td>
                      <td className="py-1.5 px-3 text-gray-700 max-w-[160px] truncate">{e.supplier?.name || e.supplier_name || '—'}</td>
                      <td className="py-1.5 px-3 text-gray-700">{e.category?.label || e.category_code}</td>
                      <td className="py-1.5 px-3 font-mono text-[11px]">{e.invoice_number || '—'}</td>
                      <td className="py-1.5 px-3 text-right font-semibold tabular-nums">{money(e.total_cents)}</td>
                      <td className="py-1.5 px-3 text-center text-[10px] uppercase font-bold text-gray-500">{e.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          <div className="bg-gradient-to-r from-gray-900 to-gray-800 text-white rounded-xl p-4 flex items-center justify-between shadow-lg">
            <span className="text-sm uppercase tracking-wider font-semibold">Grand Total</span>
            <span className="text-2xl font-bold tabular-nums">{money(grandTotal)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-vehicle P&L
// ---------------------------------------------------------------------------
function PLByVehicleTab() {
  const { data: deals = [] } = useQuery({
    queryKey: ['deals-pl'],
    queryFn: async () => {
      const r = await fetch(`${API_URL}/deals`);
      return r.ok ? r.json() : [];
    },
  });

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gradient-to-r from-gray-800 to-gray-900 text-white text-xs uppercase">
            <th className="py-2.5 px-3 text-left">Stock #</th>
            <th className="py-2.5 px-3 text-left">Vehicle</th>
            <th className="py-2.5 px-3 text-left">Customer</th>
            <th className="py-2.5 px-3 text-right">Sale Price</th>
            <th className="py-2.5 px-3 text-right">Vehicle Cost</th>
            <th className="py-2.5 px-3 text-right">Expenses</th>
            <th className="py-2.5 px-3 text-right">Net P&L</th>
          </tr>
        </thead>
        <tbody>
          {deals.slice(0, 200).map((d) => (
            <PLRow key={d.id} deal={d} />
          ))}
        </tbody>
      </table>
      {deals.length === 0 && <div className="p-6 text-center text-gray-400 italic">No deals loaded.</div>}
    </div>
  );
}

function PLRow({ deal }) {
  const { data: summary } = useQuery({
    queryKey: ['expenses', 'stock', deal.stock_number],
    queryFn: async () => {
      if (!deal.stock_number) return { total_cents: 0 };
      const p = new URLSearchParams({ stock_number: deal.stock_number, limit: '500' });
      const r = await fetch(`${API_URL}/expenses?${p}`);
      if (!r.ok) return { total_cents: 0 };
      const list = await r.json();
      const total = list
        .filter((e) => e.status === 'approved' || e.status === 'paid')
        .reduce((s, e) => s + (e.total_cents || 0), 0);
      return { total_cents: total };
    },
    enabled: !!deal.stock_number,
  });

  const sale = Math.round((Number(deal.sale_price) || 0) * 100);
  const cost = Math.round((Number(deal.vehicle_cost) || 0) * 100);
  const exp  = summary?.total_cents || 0;
  const pl   = sale - cost - exp;
  const plColor = pl >= 0 ? 'text-emerald-700' : 'text-red-600';

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50">
      <td className="py-2 px-3 font-mono text-xs">{deal.stock_number || '—'}</td>
      <td className="py-2 px-3">{deal.vehicle_year} {deal.vehicle_make} {deal.vehicle_model}</td>
      <td className="py-2 px-3 text-gray-600 truncate max-w-[160px]">{deal.customer_name}</td>
      <td className="py-2 px-3 text-right tabular-nums">{money(sale)}</td>
      <td className="py-2 px-3 text-right tabular-nums">{money(cost)}</td>
      <td className="py-2 px-3 text-right tabular-nums text-amber-700">{money(exp)}</td>
      <td className={`py-2 px-3 text-right font-bold tabular-nums ${plColor}`}>{money(pl)}</td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Vendor spend
// ---------------------------------------------------------------------------
function VendorSpendTab() {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today.slice(0, 4) + '-01-01');
  const [to, setTo] = useState(today);

  const { data: expenses = [] } = useQuery({
    queryKey: ['expenses', 'vendor', from, to],
    queryFn: async () => {
      const p = new URLSearchParams({ from, to, limit: '5000' });
      const r = await fetch(`${API_URL}/expenses?${p}`);
      return r.ok ? r.json() : [];
    },
  });

  const byVendor = {};
  for (const e of expenses) {
    if (e.status === 'void' || e.status === 'rejected') continue;
    const name = e.supplier?.name || e.supplier_name || '— no supplier —';
    if (!byVendor[name]) byVendor[name] = { total: 0, count: 0 };
    byVendor[name].total += e.total_cents || 0;
    byVendor[name].count += 1;
  }
  const sorted = Object.entries(byVendor).sort((a, b) => b[1].total - a[1].total);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex items-end gap-3">
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gradient-to-r from-gray-800 to-gray-900 text-white text-xs uppercase">
            <tr>
              <th className="py-2.5 px-3 text-left">Supplier</th>
              <th className="py-2.5 px-3 text-right">Transactions</th>
              <th className="py-2.5 px-3 text-right">Total Spend</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(([name, g]) => (
              <tr key={name} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2 px-3 font-medium">{name}</td>
                <td className="py-2 px-3 text-right tabular-nums">{g.count}</td>
                <td className="py-2 px-3 text-right font-bold tabular-nums">{money(g.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {sorted.length === 0 && <div className="p-6 text-center text-gray-400 italic">No vendor expenses in this range.</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aged inventory
// ---------------------------------------------------------------------------
function AgedInventoryTab() {
  const { data: inventory = [] } = useQuery({
    queryKey: ['inventory-aged'],
    queryFn: async () => {
      const r = await fetch(`${API_URL}/inventory`);
      return r.ok ? r.json() : [];
    },
  });

  const daysSince = (d) => {
    if (!d) return 0;
    return Math.floor((Date.now() - new Date(d).getTime()) / (1000 * 60 * 60 * 24));
  };
  const ageColor = (n) => n >= 90 ? 'bg-red-100 text-red-700' : n >= 60 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700';

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gradient-to-r from-gray-800 to-gray-900 text-white text-xs uppercase">
          <tr>
            <th className="py-2.5 px-3 text-left">Stock #</th>
            <th className="py-2.5 px-3 text-left">Vehicle</th>
            <th className="py-2.5 px-3 text-left">Acquired</th>
            <th className="py-2.5 px-3 text-right">Days in Stock</th>
            <th className="py-2.5 px-3 text-right">Purchase Cost</th>
            <th className="py-2.5 px-3 text-right">Recon</th>
            <th className="py-2.5 px-3 text-right">Total Cost</th>
          </tr>
        </thead>
        <tbody>
          {inventory
            .filter((v) => v.location_status !== 'delivered')
            .sort((a, b) => new Date(a.acquisition_date || 0) - new Date(b.acquisition_date || 0))
            .map((v) => {
              const days = daysSince(v.acquisition_date);
              const total = (v.acquisition_cost || 0) + (v.transport_cost || 0) + (v.recon_cost || 0);
              return (
                <tr key={v.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 px-3 font-mono text-xs">{v.stock_number}</td>
                  <td className="py-2 px-3">{v.year} {v.make} {v.model}</td>
                  <td className="py-2 px-3 text-gray-600">{v.acquisition_date}</td>
                  <td className="py-2 px-3 text-right">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold tabular-nums ${ageColor(days)}`}>
                      {days} days
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums">{money(v.acquisition_cost)}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-amber-700">{money((v.transport_cost || 0) + (v.recon_cost || 0))}</td>
                  <td className="py-2 px-3 text-right font-bold tabular-nums">{money(total)}</td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profit/Loss Journal — every delivered deal with purchase cost, expenses,
// sale price, gross profit, gross %.
// ---------------------------------------------------------------------------
function PLJournalTab() {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today.slice(0, 4) + '-01-01');
  const [to, setTo] = useState(today);
  const [onlyDelivered, setOnlyDelivered] = useState(true);

  const { data: deals = [] } = useQuery({
    queryKey: ['deals-plj'],
    queryFn: async () => {
      const r = await fetch(`${API_URL}/deals`);
      return r.ok ? r.json() : [];
    },
  });

  const { data: expensesAll = [] } = useQuery({
    queryKey: ['expenses-plj', from, to],
    queryFn: async () => {
      const p = new URLSearchParams({ from, to, limit: '10000' });
      const r = await fetch(`${API_URL}/expenses?${p}`);
      return r.ok ? r.json() : [];
    },
  });

  // Aggregate expense totals by stock number (approved/paid only).
  const expByStock = {};
  for (const e of expensesAll) {
    if (!e.stock_number) continue;
    if (!(e.status === 'approved' || e.status === 'paid')) continue;
    expByStock[e.stock_number] = (expByStock[e.stock_number] || 0) + (e.total_cents || 0);
  }

  const rows = deals
    .filter((d) => {
      if (onlyDelivered && d.deal_status !== 'complete') return false;
      if (d.delivery_date) {
        const dd = d.delivery_date.slice(0, 10);
        if (dd < from || dd > to) return false;
      }
      return true;
    })
    .map((d) => {
      const sale = Math.round((Number(d.sale_price) || 0) * 100);
      const cost = Math.round((Number(d.vehicle_cost) || 0) * 100);
      const exp  = expByStock[d.stock_number] || 0;
      const gross = sale - cost - exp;
      const pct = sale > 0 ? (gross / sale) * 100 : 0;
      return { d, sale, cost, exp, gross, pct };
    });

  const totals = rows.reduce((s, r) => ({
    sale: s.sale + r.sale, cost: s.cost + r.cost, exp: s.exp + r.exp, gross: s.gross + r.gross,
  }), { sale: 0, cost: 0, exp: 0, gross: 0 });

  const exportCsv = () => {
    const header = ['Delivery', 'Stock #', 'Year', 'Make', 'Model', 'Customer', 'Salesperson', 'Sale', 'Vehicle Cost', 'Expenses', 'Gross', 'Gross %'];
    const body = rows.map(({ d, sale, cost, exp, gross, pct }) => [
      d.delivery_date?.slice(0, 10) || '', d.stock_number || '', d.year || '', d.make || '', d.model || '',
      (d.customer_name || '').replace(/,/g, ';'), (d.salesperson_name || '').replace(/,/g, ';'),
      (sale / 100).toFixed(2), (cost / 100).toFixed(2), (exp / 100).toFixed(2),
      (gross / 100).toFixed(2), pct.toFixed(1),
    ]);
    const csv = [header, ...body].map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `pl_journal_${from}_to_${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
        </div>
        <label className="inline-flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-300 rounded-lg cursor-pointer">
          <input type="checkbox" checked={onlyDelivered} onChange={(e) => setOnlyDelivered(e.target.checked)} />
          Delivered only
        </label>
        <button onClick={exportCsv} className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 text-sm font-semibold bg-gradient-to-r from-emerald-600 to-emerald-500 text-white rounded-lg shadow-sm hover:shadow-md">
          <Download size={14} /> Export CSV
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gradient-to-r from-gray-800 to-gray-900 text-white uppercase">
            <tr>
              <th className="py-2 px-3 text-left">Delivered</th>
              <th className="py-2 px-3 text-left">Stock #</th>
              <th className="py-2 px-3 text-left">Vehicle</th>
              <th className="py-2 px-3 text-left">Customer</th>
              <th className="py-2 px-3 text-left">Salesperson</th>
              <th className="py-2 px-3 text-right">Sale</th>
              <th className="py-2 px-3 text-right">Cost</th>
              <th className="py-2 px-3 text-right">Expenses</th>
              <th className="py-2 px-3 text-right">Gross</th>
              <th className="py-2 px-3 text-right">%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ d, sale, cost, exp, gross, pct }) => (
              <tr key={d.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-1.5 px-3 text-gray-600">{d.delivery_date?.slice(0, 10) || '—'}</td>
                <td className="py-1.5 px-3 font-mono text-[11px]">{d.stock_number || '—'}</td>
                <td className="py-1.5 px-3">{d.year} {d.make} {d.model}</td>
                <td className="py-1.5 px-3 text-gray-700 truncate max-w-[140px]">{d.customer_name}</td>
                <td className="py-1.5 px-3 text-gray-600 truncate max-w-[120px]">{d.salesperson_name}</td>
                <td className="py-1.5 px-3 text-right tabular-nums">{money(sale)}</td>
                <td className="py-1.5 px-3 text-right tabular-nums">{money(cost)}</td>
                <td className="py-1.5 px-3 text-right tabular-nums text-amber-700">{money(exp)}</td>
                <td className={`py-1.5 px-3 text-right font-bold tabular-nums ${gross >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{money(gross)}</td>
                <td className={`py-1.5 px-3 text-right tabular-nums ${gross >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{pct.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gradient-to-r from-gray-900 to-gray-800 text-white font-bold">
              <td className="py-2.5 px-3" colSpan={5}>Totals ({rows.length} deals)</td>
              <td className="py-2.5 px-3 text-right tabular-nums">{money(totals.sale)}</td>
              <td className="py-2.5 px-3 text-right tabular-nums">{money(totals.cost)}</td>
              <td className="py-2.5 px-3 text-right tabular-nums">{money(totals.exp)}</td>
              <td className={`py-2.5 px-3 text-right tabular-nums ${totals.gross >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{money(totals.gross)}</td>
              <td className="py-2.5 px-3 text-right tabular-nums">{totals.sale ? ((totals.gross / totals.sale) * 100).toFixed(1) : '0.0'}%</td>
            </tr>
          </tfoot>
        </table>
        {rows.length === 0 && <div className="p-6 text-center text-gray-400 italic">No deals match these filters.</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Salesperson Commissions — grouped by salesperson_name, totals per person.
// ---------------------------------------------------------------------------
function SalespersonCommissionsTab() {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today.slice(0, 4) + '-01-01');
  const [to, setTo] = useState(today);

  const { data: deals = [] } = useQuery({
    queryKey: ['deals-commissions'],
    queryFn: async () => {
      const r = await fetch(`${API_URL}/deals`);
      return r.ok ? r.json() : [];
    },
  });

  const filtered = deals.filter((d) => {
    if (d.deal_status !== 'complete') return false;
    const dd = (d.delivery_date || d.updated_at || '').slice(0, 10);
    return dd >= from && dd <= to;
  });

  const byPerson = {};
  for (const d of filtered) {
    const key = d.salesperson_name || '— unassigned —';
    if (!byPerson[key]) byPerson[key] = { deals: 0, sale: 0, gross: 0, commission: 0 };
    const sale = Math.round((Number(d.sale_price) || 0) * 100);
    const cost = Math.round((Number(d.vehicle_cost) || 0) * 100);
    const comm = Math.round((Number(d.commission_amount) || 0) * 100);
    byPerson[key].deals += 1;
    byPerson[key].sale += sale;
    byPerson[key].gross += (sale - cost);
    byPerson[key].commission += comm;
  }
  const rows = Object.entries(byPerson).sort((a, b) => b[1].commission - a[1].commission);
  const totals = rows.reduce((s, [, g]) => ({
    deals: s.deals + g.deals, sale: s.sale + g.sale, gross: s.gross + g.gross, commission: s.commission + g.commission,
  }), { deals: 0, sale: 0, gross: 0, commission: 0 });

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex items-end gap-3">
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gradient-to-r from-gray-800 to-gray-900 text-white text-xs uppercase">
            <tr>
              <th className="py-2.5 px-3 text-left">Salesperson</th>
              <th className="py-2.5 px-3 text-right">Deals</th>
              <th className="py-2.5 px-3 text-right">Sales Volume</th>
              <th className="py-2.5 px-3 text-right">Front Gross</th>
              <th className="py-2.5 px-3 text-right">Commission</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, g]) => (
              <tr key={name} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2 px-3 font-medium">{name}</td>
                <td className="py-2 px-3 text-right tabular-nums">{g.deals}</td>
                <td className="py-2 px-3 text-right tabular-nums">{money(g.sale)}</td>
                <td className={`py-2 px-3 text-right tabular-nums ${g.gross >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{money(g.gross)}</td>
                <td className="py-2 px-3 text-right font-bold tabular-nums text-red-700">{money(g.commission)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gradient-to-r from-gray-900 to-gray-800 text-white font-bold">
              <td className="py-2.5 px-3">Totals</td>
              <td className="py-2.5 px-3 text-right tabular-nums">{totals.deals}</td>
              <td className="py-2.5 px-3 text-right tabular-nums">{money(totals.sale)}</td>
              <td className="py-2.5 px-3 text-right tabular-nums">{money(totals.gross)}</td>
              <td className="py-2.5 px-3 text-right tabular-nums">{money(totals.commission)}</td>
            </tr>
          </tfoot>
        </table>
        {rows.length === 0 && <div className="p-6 text-center text-gray-400 italic">No delivered deals in this range.</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vehicle Purchase Journal — from inventory, grouped by vendor or finance type.
// ---------------------------------------------------------------------------
function PurchaseJournalTab() {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today.slice(0, 4) + '-01-01');
  const [to, setTo] = useState(today);
  const [groupBy, setGroupBy] = useState('vendor');

  const { data: inventory = [] } = useQuery({
    queryKey: ['inventory-purchase'],
    queryFn: async () => {
      const r = await fetch(`${API_URL}/inventory`);
      return r.ok ? r.json() : [];
    },
  });

  const filtered = inventory.filter((v) => {
    const d = (v.acquisition_date || '').slice(0, 10);
    return d >= from && d <= to;
  });

  const groups = {};
  for (const v of filtered) {
    const key = groupBy === 'vendor' ? (v.acquired_from || v.source_name || '— unknown —')
             : groupBy === 'type'   ? (v.acquisition_type || 'other')
             : 'All purchases';
    if (!groups[key]) groups[key] = { items: [], total: 0 };
    const total = (v.acquisition_cost || 0) + (v.transport_cost || 0);
    groups[key].items.push({ v, total });
    groups[key].total += total;
  }
  const grandTotal = Object.values(groups).reduce((s, g) => s + g.total, 0);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex items-end gap-3">
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Group by</label>
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm">
            <option value="vendor">Vendor</option>
            <option value="type">Acquisition Type</option>
            <option value="none">None</option>
          </select>
        </div>
      </div>

      <div className="space-y-3">
        {Object.entries(groups).map(([key, g]) => (
          <div key={key} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 py-2.5 bg-gradient-to-r from-gray-50 to-white border-b border-gray-200 flex items-center justify-between">
              <span className="text-sm font-bold text-gray-800">{key}</span>
              <span className="text-sm font-bold text-gray-900 tabular-nums">{money(g.total)} · {g.items.length} units</span>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-100">
                  <th className="py-2 px-3 text-left">Acquired</th>
                  <th className="py-2 px-3 text-left">Stock #</th>
                  <th className="py-2 px-3 text-left">Vehicle</th>
                  <th className="py-2 px-3 text-left">Type</th>
                  <th className="py-2 px-3 text-right">Purchase</th>
                  <th className="py-2 px-3 text-right">Transport</th>
                  <th className="py-2 px-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {g.items.map(({ v, total }) => (
                  <tr key={v.id} className="border-b border-gray-50 last:border-b-0 hover:bg-gray-50">
                    <td className="py-1.5 px-3 text-gray-600">{v.acquisition_date}</td>
                    <td className="py-1.5 px-3 font-mono text-[11px]">{v.stock_number}</td>
                    <td className="py-1.5 px-3">{v.year} {v.make} {v.model}</td>
                    <td className="py-1.5 px-3 text-gray-600">{(v.acquisition_type || '').replace('_', ' ')}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums">{money(v.acquisition_cost)}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums">{money(v.transport_cost)}</td>
                    <td className="py-1.5 px-3 text-right font-semibold tabular-nums">{money(total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {Object.keys(groups).length === 0 && (
          <div className="text-center text-gray-400 italic py-8">No purchases in this range.</div>
        )}
        {grandTotal > 0 && (
          <div className="bg-gradient-to-r from-gray-900 to-gray-800 text-white rounded-xl p-4 flex items-center justify-between shadow-lg">
            <span className="text-sm uppercase tracking-wider font-semibold">Grand Total</span>
            <span className="text-2xl font-bold tabular-nums">{money(grandTotal)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
export default function AccountingPage() {
  const [tab, setTab] = useState('reconciliation');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-600 to-red-500 text-white flex items-center justify-center shadow">
          <Calculator size={20} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Accounting</h1>
          <p className="text-xs text-gray-500">Reconciliation, P&amp;L, vendor spend, aged inventory</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="flex items-center gap-1 px-3 pt-1 border-b border-gray-200 bg-gradient-to-b from-gray-50 to-white overflow-x-auto">
          <Tab active={tab === 'reconciliation'} onClick={() => setTab('reconciliation')} icon={Receipt}>Reconciliation</Tab>
          <Tab active={tab === 'pl'} onClick={() => setTab('pl')} icon={TrendingUp}>P&amp;L by Vehicle</Tab>
          <Tab active={tab === 'vendor'} onClick={() => setTab('vendor')} icon={Building2}>Vendor Spend</Tab>
          <Tab active={tab === 'aged'} onClick={() => setTab('aged')} icon={Clock}>Aged Inventory</Tab>
          <Tab active={tab === 'plj'} onClick={() => setTab('plj')} icon={BookOpen}>P&amp;L Journal</Tab>
          <Tab active={tab === 'commissions'} onClick={() => setTab('commissions')} icon={Users}>Commissions</Tab>
          <Tab active={tab === 'purchase'} onClick={() => setTab('purchase')} icon={Percent}>Purchase Journal</Tab>
          <Tab active={tab === 'more'} onClick={() => setTab('more')} icon={FileText}>More Reports</Tab>
        </div>
        <div className="p-4">
          {tab === 'reconciliation' && <ReconciliationTab />}
          {tab === 'pl' && <PLByVehicleTab />}
          {tab === 'vendor' && <VendorSpendTab />}
          {tab === 'aged' && <AgedInventoryTab />}
          {tab === 'plj' && <PLJournalTab />}
          {tab === 'commissions' && <SalespersonCommissionsTab />}
          {tab === 'purchase' && <PurchaseJournalTab />}
          {tab === 'more' && (
            <div className="text-sm text-gray-600 space-y-2">
              <p className="font-semibold">Additional reports (coming in Tier 2):</p>
              <ul className="list-disc pl-5 text-xs text-gray-500 space-y-1">
                <li>Profit/Loss Journal (with and without HST/GST)</li>
                <li>Sold Vehicles Journal — by manufacturer, by salesperson, retail vs wholesale</li>
                <li>GST / HST / PST / QST collection + summary</li>
                <li>OMVIC transaction fee register</li>
                <li>Salesperson &amp; F&amp;I commission reports</li>
                <li>Inventory list (as-at / with expenses / by floorplan)</li>
                <li>Vehicle purchase journal (by vendor / by amount / by finance type)</li>
                <li>Buyer / Traded / Returned retail / Conditional sale reports</li>
                <li>Tier 3 (new modules): Leases, Parts &amp; Service, Auction, Rental, Payroll, AR, Equifax</li>
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
