import { Gift, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import SlideOutPanel from './SlideOutPanel';
import { Toggle } from './SectionCard';
import { formatCurrency } from '../../utils/deskingCalculations';

export default function RebatesPanel({ open, onClose, state, computed, addRebate, updateRebate, removeRebate }) {
  const { t } = useTranslation();
  const rebates = Array.isArray(state?.rebates) ? state.rebates : [];

  return (
    <SlideOutPanel
      open={open}
      onClose={onClose}
      title={t('desking.rebates')}
      icon={Gift}
      footer={
        <button onClick={addRebate} className="inline-flex items-center gap-1 px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg">
          <Plus size={14} /> {t('desking.addLine')}
        </button>
      }
    >
      {rebates.length === 0 && (
        <div className="text-center py-8 text-sm text-gray-500 italic">
          {t('desking.noRebates')}
        </div>
      )}
      <div className="space-y-2">
        {rebates.map((r) => (
          <div key={r.id} className="flex items-center gap-2 p-2 border border-gray-200 rounded-lg">
            <Toggle checked={r.enabled !== false} onChange={(v) => updateRebate(r.id, { enabled: v })} />
            <input
              value={r.label}
              onChange={(e) => updateRebate(r.id, { label: e.target.value })}
              placeholder={t('desking.rebateLabel')}
              className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded"
            />
            <div className="relative w-32">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
              <input
                type="number" step="0.01"
                value={r.amount}
                onChange={(e) => updateRebate(r.id, { amount: parseFloat(e.target.value) || 0 })}
                className="w-full pl-5 pr-2 py-1 text-sm text-right border border-gray-300 rounded tabular-nums"
              />
            </div>
            <button onClick={() => removeRebate(r.id)} className="text-red-500 hover:text-red-700"><Trash2 size={14} /></button>
          </div>
        ))}
      </div>

      <div className="mt-4 p-3 bg-teal-50 rounded-lg flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-700">{t('desking.rebatesTotal')}</span>
        <span className="text-lg font-bold text-teal-700 tabular-nums">{formatCurrency(computed.rebatesTotal)}</span>
      </div>
    </SlideOutPanel>
  );
}
