import { Receipt, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import SlideOutPanel from './SlideOutPanel';
import { Toggle } from './SectionCard';
import { formatCurrency } from '../../utils/deskingCalculations';

export default function FeesPanel({ open, onClose, state, computed, updateFee, addFee, removeFee }) {
  const { t } = useTranslation();
  const fees = Array.isArray(state?.fees) ? state.fees : [];

  return (
    <SlideOutPanel
      open={open}
      onClose={onClose}
      title={t('desking.feesCharges')}
      icon={Receipt}
      footer={
        <button onClick={addFee} className="inline-flex items-center gap-1 px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg">
          <Plus size={14} /> {t('desking.addFee')}
        </button>
      }
    >
      <div className="space-y-2">
        {fees.map((f) => (
          <div key={f.id} className="flex items-center gap-2 p-2 border border-gray-200 rounded-lg">
            <Toggle checked={!!f.enabled} onChange={(v) => updateFee(f.id, { enabled: v })} />
            {f.custom ? (
              <input value={f.label} onChange={(e) => updateFee(f.id, { label: e.target.value })} className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded" />
            ) : (
              <span className="flex-1 text-sm text-gray-700 truncate">{f.label}</span>
            )}
            <label className="inline-flex items-center gap-1 text-[11px] text-gray-500">
              <input type="checkbox" checked={!!f.taxable} onChange={(e) => updateFee(f.id, { taxable: e.target.checked })} />
              Tax
            </label>
            <div className="relative w-28">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
              <input
                type="number" step="0.01"
                value={f.amount}
                onChange={(e) => updateFee(f.id, { amount: parseFloat(e.target.value) || 0 })}
                className="w-full pl-5 pr-2 py-1 text-sm text-right border border-gray-300 rounded tabular-nums"
              />
            </div>
            {f.custom && (
              <button onClick={() => removeFee(f.id)} className="text-red-500 hover:text-red-700"><Trash2 size={14} /></button>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 p-3 bg-teal-50 rounded-lg flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-700">{t('desking.feesTotal')}</span>
        <span className="text-lg font-bold text-teal-700 tabular-nums">{formatCurrency(computed.feesTotal)}</span>
      </div>
    </SlideOutPanel>
  );
}
