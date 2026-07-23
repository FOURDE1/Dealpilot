import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Car, Wrench, MapPin, DollarSign, Calendar } from 'lucide-react';
import ExpensesPanel from '../components/expenses/ExpensesPanel';

const API_URL = import.meta.env.VITE_API_URL;

function money(cents) {
  const n = Number(cents) || 0;
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(n / 100);
}

function Field({ label, value, icon: Icon }) {
  return (
    <div>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">
        {Icon && <Icon size={10} />} {label}
      </div>
      <div className="text-sm font-semibold text-gray-900">{value || '—'}</div>
    </div>
  );
}

export default function InventoryDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: unit, isLoading } = useQuery({
    queryKey: ['inventory', id],
    queryFn: async () => {
      const r = await fetch(`${API_URL}/inventory/${id}`);
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !!id,
  });

  const { data: summary } = useQuery({
    queryKey: ['expense-summary', id],
    queryFn: async () => {
      const r = await fetch(`${API_URL}/expenses/summary/inventory/${id}`);
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !!id,
  });

  if (isLoading) return <div className="p-8 text-center text-gray-400 italic">Loading…</div>;
  if (!unit) return (
    <div className="p-8 text-center">
      <p className="text-gray-600 mb-4">Inventory unit not found.</p>
      <button onClick={() => navigate('/inventory')} className="text-red-600 hover:underline text-sm">Back to inventory</button>
    </div>
  );

  const purchaseCost = unit.acquisition_cost || 0;
  const transportCost = unit.transport_cost || 0;
  const reconCost = unit.recon_cost || 0;
  const expenseTotal = summary?.total_cents || 0;
  const totalCost = purchaseCost + transportCost + reconCost + expenseTotal;

  return (
    <div className="space-y-4">
      <button onClick={() => navigate('/inventory')} className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
        <ArrowLeft size={14} /> Back to inventory
      </button>

      {/* Header card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-red-600 to-red-500 text-white flex items-center justify-center shadow">
            <Car size={26} />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-gray-900">{unit.year} {unit.make} {unit.model}</h1>
            <div className="text-xs text-gray-500 mt-0.5">
              Stock #{unit.stock_number} · VIN {unit.vin || '—'} · {unit.trim || ''}
            </div>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase tracking-wider text-gray-400">Status</span>
            <span className="px-3 py-1 text-xs font-bold bg-blue-100 text-blue-700 rounded-full">
              {(unit.location_status || 'unknown').replace('_', ' ')}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-gray-100">
          <Field label="Year" value={unit.year} icon={Calendar} />
          <Field label="Make" value={unit.make} />
          <Field label="Model" value={unit.model} />
          <Field label="Trim" value={unit.trim} />
          <Field label="Mileage" value={unit.mileage ? `${unit.mileage.toLocaleString()} km` : null} />
          <Field label="Exterior" value={unit.exterior_color} />
          <Field label="Interior" value={unit.interior_color} />
          <Field label="Fuel" value={unit.fuel_type} />
          <Field label="Acquisition" value={unit.acquisition_type?.replace('_', ' ')} />
          <Field label="Acquired" value={unit.acquisition_date} icon={Calendar} />
          <Field label="Location" value={unit.location_details} icon={MapPin} />
          <Field label="Type" value={unit.vehicle_type} />
        </div>
      </div>

      {/* Cost summary */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center gap-2 mb-4">
          <span className="h-4 w-1 rounded-full bg-gradient-to-b from-red-600 to-red-400" />
          <h2 className="text-sm uppercase tracking-widest font-bold text-gray-700">Cost Summary</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="bg-gradient-to-br from-slate-50 to-gray-100 rounded-xl p-3">
            <div className="text-[10px] uppercase text-gray-500 mb-1 flex items-center gap-1"><DollarSign size={10} /> Purchase</div>
            <div className="text-base font-bold text-gray-900 tabular-nums">{money(purchaseCost)}</div>
          </div>
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-3">
            <div className="text-[10px] uppercase text-blue-700 mb-1">Transport</div>
            <div className="text-base font-bold text-blue-900 tabular-nums">{money(transportCost)}</div>
          </div>
          <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl p-3">
            <div className="text-[10px] uppercase text-amber-700 mb-1 flex items-center gap-1"><Wrench size={10} /> Recon</div>
            <div className="text-base font-bold text-amber-900 tabular-nums">{money(reconCost)}</div>
          </div>
          <div className="bg-gradient-to-br from-purple-50 to-fuchsia-50 rounded-xl p-3">
            <div className="text-[10px] uppercase text-purple-700 mb-1">Added Expenses</div>
            <div className="text-base font-bold text-purple-900 tabular-nums">{money(expenseTotal)}</div>
          </div>
          <div className="bg-gradient-to-br from-gray-900 to-gray-800 text-white rounded-xl p-3 shadow-lg">
            <div className="text-[10px] uppercase text-white/70 mb-1">Total Cost</div>
            <div className="text-lg font-extrabold tabular-nums">{money(totalCost)}</div>
          </div>
        </div>
      </div>

      {/* Expenses */}
      <ExpensesPanel
        inventoryId={id}
        stockNumber={unit.stock_number}
        isManager={true}
        vehicle={{
          year: unit.year,
          make: unit.make,
          model: unit.model,
          trim: unit.trim,
          vin: unit.vin,
        }}
      />
    </div>
  );
}
