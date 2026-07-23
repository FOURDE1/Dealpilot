import { Car, Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '../../utils/deskingCalculations';

export default function VehicleSummary({ state, onEdit }) {
  const { t } = useTranslation();
  const v = (state && state.vehicle) || {};
  const hasVehicle = v.year || v.make || v.model || v.vin;
  const title = hasVehicle
    ? `${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim()
    : t('desking.noVehicle') || 'No vehicle selected';
  const meta = [v.color, v.vin ? `VIN: ${v.vin}` : null, v.stock ? `Stock #${v.stock}` : null]
    .filter(Boolean)
    .join(' · ');

  if (!hasVehicle) {
    return (
      <button
        onClick={onEdit}
        className="w-full bg-white rounded-xl shadow-sm border-2 border-dashed border-gray-300 p-5 text-center hover:border-red-400 hover:bg-red-50/40 transition-all duration-200"
      >
        <div className="mx-auto w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center mb-2">
          <Car size={22} />
        </div>
        <div className="text-sm font-medium text-gray-700">{t('desking.selectOrAddVehicle') || 'Select a deal or enter vehicle details'}</div>
        <div className="text-xs text-red-600 mt-1 font-semibold">+ {t('desking.addVehicle') || 'Add Vehicle'}</div>
      </button>
    );
  }

  return (
    <div className="relative bg-gradient-to-r from-white to-slate-50 rounded-xl shadow-md border border-gray-100 p-4 flex items-center gap-4 overflow-hidden transition-all duration-200 hover:shadow-lg">
      <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-red-700 via-red-600 to-red-500" />
      <div className="w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center shrink-0 ring-1 ring-red-100">
        <Car size={22} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-lg font-bold text-gray-900 truncate">{title}</div>
        <div className="text-xs text-gray-500 truncate">{meta || '—'}</div>
      </div>
      {state.msrp > 0 && (
        <div className="hidden sm:flex flex-col items-end">
          <span className="text-[10px] uppercase tracking-wider text-gray-400">MSRP</span>
          <span className="inline-flex items-center bg-blue-50 text-blue-700 font-bold text-sm px-3 py-1 rounded-full tabular-nums">
            {formatCurrency(state.msrp)}
          </span>
        </div>
      )}
      <button
        onClick={onEdit}
        className="p-2 rounded-full bg-gray-100 hover:bg-red-50 text-gray-500 hover:text-red-600 transition-all duration-200"
        title={t('desking.editVehicle') || 'Edit vehicle'}
      >
        <Pencil size={14} />
      </button>
    </div>
  );
}
