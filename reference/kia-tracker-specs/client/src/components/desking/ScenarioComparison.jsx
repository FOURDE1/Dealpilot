import { useTranslation } from 'react-i18next';
import { Layers, Star, Trash2, Upload } from 'lucide-react';
import { formatCurrency, formatPercent } from '../../utils/deskingCalculations';

export default function ScenarioComparison({ scenarios, activeDealType, onLoad, onDelete, onToggleRecommend }) {
  const { t } = useTranslation();
  const list = Array.isArray(scenarios) ? scenarios : [];

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4 print:hidden">
      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-3">
        <Layers size={14} /> {t('desking.scenarios')}
      </h3>
      {list.length === 0 ? (
        <p className="text-xs text-gray-400 italic">{t('desking.noScenarios')}</p>
      ) : (
        <div className="space-y-2">
          {list.map((s) => {
            const c = s.snapshot || {};
            return (
              <div key={s.id} className={`rounded-lg border p-3 ${s.recommended ? 'border-amber-400 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <button onClick={() => onToggleRecommend(s.id)} className={s.recommended ? 'text-amber-500' : 'text-gray-300 hover:text-amber-400'}>
                      <Star size={14} fill={s.recommended ? 'currentColor' : 'none'} />
                    </button>
                    <span className="text-xs font-semibold text-gray-800 truncate">{s.name}</span>
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 bg-teal-100 text-teal-700 rounded uppercase font-bold">{c.dealType}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
                  <div><span className="text-gray-500">{t('desking.monthly')}:</span> <span className="font-semibold">{formatCurrency(c.monthly || 0)}</span></div>
                  <div><span className="text-gray-500">{t('desking.term')}:</span> <span className="font-semibold">{c.term || '—'}</span></div>
                  <div><span className="text-gray-500">{t('desking.rate')}:</span> <span className="font-semibold">{c.rate ? formatPercent(c.rate) : '—'}</span></div>
                  <div><span className="text-gray-500">{t('desking.totalDown')}:</span> <span className="font-semibold">{formatCurrency(c.totalDown || 0)}</span></div>
                </div>
                <div className="mt-2 flex gap-1">
                  <button onClick={() => onLoad(s)} className="flex-1 inline-flex items-center justify-center gap-1 py-1 text-[10px] bg-teal-600 hover:bg-teal-700 text-white rounded font-semibold">
                    <Upload size={10} /> {t('desking.load')}
                  </button>
                  <button onClick={() => onDelete(s.id)} className="p-1 bg-red-100 text-red-600 hover:bg-red-200 rounded">
                    <Trash2 size={10} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
