import { useState, useEffect, useMemo } from 'react';
import { Car, Eye, EyeOff, Search, Receipt, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../supabaseClient';
import SlideOutPanel from './SlideOutPanel';
import { Field, MoneyInput, NumberInput, TextInput } from './SectionCard';
import ExpensesPanel from '../expenses/ExpensesPanel';

export default function VehiclePanel({ open, onClose, state, setVehicle, setField, isManager = true }) {
  const { t } = useTranslation();
  const [showCost, setShowCost] = useState(false);
  const [mode, setMode] = useState('stock'); // 'stock' | 'manual'
  const [stockOptions, setStockOptions] = useState([]);
  const [stockSearch, setStockSearch] = useState('');
  const [loadingStock, setLoadingStock] = useState(false);
  const [selectedInventoryId, setSelectedInventoryId] = useState(null);
  const [showExpenses, setShowExpenses] = useState(false);

  const v = (state && state.vehicle) || {};

  // Load available stock units from inventory API when panel opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoadingStock(true);
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess?.session?.access_token;
        const res = await fetch(
          (import.meta.env.VITE_API_URL || 'http://localhost:3001/api') + '/inventory',
          { headers: token ? { Authorization: `Bearer ${token}` } : {} }
        );
        const json = await res.json();
        const rows = (json?.data || json || []).map((u) => ({
          id: u.id,
          stock_number: u.stock_number,
          vin: u.vin,
          year: u.year,
          make: u.make,
          model: [u.model, u.trim].filter(Boolean).join(' '),
          color: u.exterior_color || u.color,
          sale_price: u.list_price != null ? Number(u.list_price) / 100 : null,
        }));
        if (!cancelled) setStockOptions(rows);
      } catch (e) {
        console.error('Failed to load inventory:', e);
        if (!cancelled) setStockOptions([]);
      } finally {
        if (!cancelled) setLoadingStock(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  const filteredStock = useMemo(() => {
    const q = stockSearch.trim().toLowerCase();
    if (!q) return stockOptions.slice(0, 50);
    return stockOptions
      .filter((u) => {
        const hay = [u.stock_number, u.vin, u.year, u.make, u.model, u.color]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 50);
  }, [stockSearch, stockOptions]);

  const applyStockUnit = (u) => {
    setVehicle({
      year: u.year || '',
      make: u.make || '',
      model: u.model || '',
      color: u.color || '',
      vin: u.vin || '',
      stock: u.stock_number || '',
    });
    if (u.sale_price != null) {
      setField('salePrice', Number(u.sale_price) || 0);
      if (!state.msrp) setField('msrp', Number(u.sale_price) || 0);
    }
    setSelectedInventoryId(u.id || null);
  };

  return (
    <SlideOutPanel open={open} onClose={onClose} title={t('desking.vehicle')} icon={Car}>
      {/* Mode tabs */}
      <div className="flex gap-2 mb-4 p-1 bg-gray-100 rounded-lg">
        <button
          type="button"
          onClick={() => setMode('stock')}
          className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-all ${
            mode === 'stock' ? 'bg-white shadow text-red-600' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          {t('desking.selectFromStock') || 'Select from Stock'}
        </button>
        <button
          type="button"
          onClick={() => setMode('manual')}
          className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-all ${
            mode === 'manual' ? 'bg-white shadow text-red-600' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          {t('desking.manualEntry') || 'Manual Entry'}
        </button>
      </div>

      {mode === 'stock' && (
        <div className="mb-4">
          <div className="relative mb-2">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={stockSearch}
              onChange={(e) => setStockSearch(e.target.value)}
              placeholder={t('desking.searchStock') || 'Search by stock #, VIN, make, model...'}
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
          <div className="max-h-60 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
            {loadingStock && (
              <div className="px-3 py-3 text-sm text-gray-500">Loading stock...</div>
            )}
            {!loadingStock && filteredStock.length === 0 && (
              <div className="px-3 py-3 text-sm text-gray-500">
                {stockOptions.length === 0 ? 'No stock units found' : 'No matches'}
              </div>
            )}
            {!loadingStock &&
              filteredStock.map((u) => {
                const selected = v.stock && u.stock_number === v.stock;
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => applyStockUnit(u)}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-red-50 transition-colors ${
                      selected ? 'bg-red-50 border-l-4 border-red-600' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-gray-900">
                        #{u.stock_number}{' '}
                        <span className="font-normal text-gray-600">
                          {[u.year, u.make, u.model].filter(Boolean).join(' ')}
                        </span>
                      </div>
                      {u.sale_price != null && (
                        <span className="text-xs font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">
                          ${Number(u.sale_price).toLocaleString()}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {[u.color, u.vin && `VIN: ${u.vin}`].filter(Boolean).join(' · ')}
                    </div>
                  </button>
                );
              })}
          </div>
          {v.stock && (
            <div className="mt-3 text-xs text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2 flex items-center justify-between gap-2">
              <span>
                ✓ Loaded stock <strong>#{v.stock}</strong> — {v.year} {v.make} {v.model}
              </span>
              {selectedInventoryId && (
                <button
                  type="button"
                  onClick={() => setShowExpenses(true)}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-white border border-green-300 rounded text-green-700 hover:bg-green-100 text-xs font-medium whitespace-nowrap"
                >
                  <Receipt size={12} />
                  View Expenses
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Vehicle fields (always shown; editable, autofilled in stock mode) */}
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('desking.year')}>
          <TextInput value={v.year} onChange={(x) => setVehicle({ year: x })} />
        </Field>
        <Field label={t('desking.make')}>
          <TextInput value={v.make} onChange={(x) => setVehicle({ make: x })} />
        </Field>
        <Field label={t('desking.model')}>
          <TextInput value={v.model} onChange={(x) => setVehicle({ model: x })} />
        </Field>
        <Field label={t('desking.color')}>
          <TextInput value={v.color} onChange={(x) => setVehicle({ color: x })} />
        </Field>
        <Field label="VIN" className="col-span-2">
          <TextInput value={v.vin} onChange={(x) => setVehicle({ vin: x })} />
        </Field>
        <Field label={t('desking.stock')}>
          <TextInput value={v.stock} onChange={(x) => setVehicle({ stock: x })} />
        </Field>
        <Field label={t('desking.mileage')}>
          <NumberInput
            value={v.mileage}
            onChange={(x) => setVehicle({ mileage: x })}
            suffix="km"
          />
        </Field>
        <Field label={t('desking.condition')}>
          <select
            value={v.condition || 'new'}
            onChange={(e) => setVehicle({ condition: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            <option value="new">{t('desking.new')}</option>
            <option value="used">{t('desking.used')}</option>
          </select>
        </Field>
        <Field label={t('desking.msrp')}>
          <MoneyInput value={state.msrp} onChange={(x) => setField('msrp', x)} />
        </Field>
        <Field label={t('desking.salePrice')}>
          <MoneyInput value={state.salePrice} onChange={(x) => setField('salePrice', x)} />
        </Field>
        {isManager && (
          <Field
            label={
              <span className="inline-flex items-center gap-2">
                {t('desking.vehicleCost')}
                <button
                  onClick={() => setShowCost((s) => !s)}
                  type="button"
                  className="text-gray-400 hover:text-gray-600"
                >
                  {showCost ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </span>
            }
          >
            <MoneyInput
              value={state.vehicleCost}
              onChange={(x) => setField('vehicleCost', x)}
              type={showCost ? 'text' : 'password'}
            />
          </Field>
        )}
      </div>

      {/* Expenses modal */}
      {showExpenses && selectedInventoryId && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => setShowExpenses(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 sticky top-0 bg-white">
              <div className="flex items-center gap-2">
                <Receipt size={18} className="text-red-600" />
                <h3 className="font-semibold text-gray-900">
                  Expenses — Stock #{v.stock}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowExpenses(false)}
                className="text-gray-400 hover:text-gray-600 p-1"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-4">
              <ExpensesPanel
                inventoryId={selectedInventoryId}
                stockNumber={v.stock}
                isManager={isManager}
              />
            </div>
          </div>
        </div>
      )}
    </SlideOutPanel>
  );
}
