import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { TrendingUp, TrendingDown, Users, Trophy, XCircle, Clock } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL;

const PERIODS = [
  { value: '30d', labelKey: 'winLoss.period.30d' },
  { value: '90d', labelKey: 'winLoss.period.90d' },
  { value: '6m',  labelKey: 'winLoss.period.6m' },
  { value: '1y',  labelKey: 'winLoss.period.1y' },
  { value: 'all', labelKey: 'winLoss.period.all' },
];

const BAR_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4', '#F97316', '#EC4899', '#6B7280'];

export default function WinLossPage() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState('90d');

  const { data, isLoading } = useQuery({
    queryKey: ['win-loss', period],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/analytics/win-loss?period=${period}`);
      return res.ok ? res.json() : null;
    },
  });

  const s = data?.summary;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('winLoss.title')}</h1>
        <select value={period} onChange={e => setPeriod(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-200 text-sm">
          {PERIODS.map(p => <option key={p.value} value={p.value}>{t(p.labelKey)}</option>)}
        </select>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600" />
        </div>
      ) : !data ? (
        <p className="text-center py-16 text-gray-400">{t('winLoss.noData')}</p>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center gap-2 text-xs font-medium text-gray-500 uppercase mb-1">
                <Users size={14} /> {t('winLoss.total')}
              </div>
              <p className="text-2xl font-bold text-gray-900">{s.total}</p>
            </div>
            <div className="bg-white rounded-xl border border-green-200 p-4 bg-green-50/50">
              <div className="flex items-center gap-2 text-xs font-medium text-green-600 uppercase mb-1">
                <Trophy size={14} /> {t('winLoss.won')}
              </div>
              <p className="text-2xl font-bold text-green-700">{s.won}</p>
            </div>
            <div className="bg-white rounded-xl border border-red-200 p-4 bg-red-50/50">
              <div className="flex items-center gap-2 text-xs font-medium text-red-600 uppercase mb-1">
                <XCircle size={14} /> {t('winLoss.lost')}
              </div>
              <p className="text-2xl font-bold text-red-700">{s.lost}</p>
            </div>
            <div className="bg-white rounded-xl border border-blue-200 p-4 bg-blue-50/50">
              <div className="flex items-center gap-2 text-xs font-medium text-blue-600 uppercase mb-1">
                {s.winRate >= 50 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                {t('winLoss.winRate')}
              </div>
              <p className={`text-2xl font-bold ${s.winRate >= 50 ? 'text-green-700' : 'text-red-700'}`}>
                {s.winRate}%
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {/* Lost Reasons */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-bold text-gray-900 mb-4">{t('winLoss.lostReasons')}</h2>
              {data.lostReasons.length === 0 ? (
                <p className="text-xs text-gray-400 py-6 text-center">{t('winLoss.noData')}</p>
              ) : (
                <div className="space-y-3">
                  {data.lostReasons.map((r, i) => (
                    <div key={r.reason}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-medium text-gray-700">{r.reason}</span>
                        <span className="text-gray-500">{r.count} ({r.percentage}%)</span>
                      </div>
                      <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${r.percentage}%`, backgroundColor: BAR_COLORS[i % BAR_COLORS.length] }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Monthly Trend */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-bold text-gray-900 mb-4">{t('winLoss.monthlyTrend')}</h2>
              {data.monthlyTrend.length === 0 ? (
                <p className="text-xs text-gray-400 py-6 text-center">{t('winLoss.noData')}</p>
              ) : (
                <div className="space-y-2">
                  {data.monthlyTrend.map(m => {
                    const max = Math.max(...data.monthlyTrend.map(x => x.won + x.lost), 1);
                    const wonPct = ((m.won / max) * 100).toFixed(0);
                    const lostPct = ((m.lost / max) * 100).toFixed(0);
                    return (
                      <div key={m.month} className="flex items-center gap-3">
                        <span className="text-[10px] text-gray-500 w-14 shrink-0">{m.month}</span>
                        <div className="flex-1 flex gap-0.5 h-5">
                          {m.won > 0 && (
                            <div className="bg-green-500 rounded-sm h-full transition-all" style={{ width: `${wonPct}%` }}
                              title={`Won: ${m.won}`} />
                          )}
                          {m.lost > 0 && (
                            <div className="bg-red-400 rounded-sm h-full transition-all" style={{ width: `${lostPct}%` }}
                              title={`Lost: ${m.lost}`} />
                          )}
                        </div>
                        <span className={`text-[10px] font-bold w-10 text-right ${m.winRate >= 50 ? 'text-green-600' : 'text-red-600'}`}>
                          {m.winRate}%
                        </span>
                      </div>
                    );
                  })}
                  <div className="flex gap-4 pt-2 border-t border-gray-100 text-[10px] text-gray-400">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-green-500" /> Won</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-400" /> Lost</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Source Performance */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-bold text-gray-900 mb-4">{t('winLoss.sourcePerformance')}</h2>
            {data.sourcePerformance.length === 0 ? (
              <p className="text-xs text-gray-400 py-6 text-center">{t('winLoss.noData')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-medium text-gray-500 uppercase border-b border-gray-200">
                      <th className="px-3 py-2">Source</th>
                      <th className="px-3 py-2 text-center">{t('winLoss.total')}</th>
                      <th className="px-3 py-2 text-center">{t('winLoss.won')}</th>
                      <th className="px-3 py-2 text-center">{t('winLoss.lost')}</th>
                      <th className="px-3 py-2 text-center">{t('winLoss.winRate')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sourcePerformance.map(s => {
                      const best = data.sourcePerformance.length > 1 &&
                        s.winRate === Math.max(...data.sourcePerformance.filter(x => x.won + x.lost > 0).map(x => x.winRate));
                      const worst = data.sourcePerformance.length > 1 &&
                        s.winRate === Math.min(...data.sourcePerformance.filter(x => x.won + x.lost > 0).map(x => x.winRate)) &&
                        (s.won + s.lost) > 0;
                      return (
                        <tr key={s.source} className={`border-b border-gray-50 ${best ? 'bg-green-50/50' : worst ? 'bg-red-50/50' : ''}`}>
                          <td className="px-3 py-2.5 font-medium text-gray-700 capitalize">{s.source.replace('_', ' ')}</td>
                          <td className="px-3 py-2.5 text-center text-gray-600">{s.total}</td>
                          <td className="px-3 py-2.5 text-center text-green-600 font-medium">{s.won}</td>
                          <td className="px-3 py-2.5 text-center text-red-600 font-medium">{s.lost}</td>
                          <td className="px-3 py-2.5 text-center">
                            <span className={`font-bold ${s.winRate >= 50 ? 'text-green-600' : (s.won + s.lost) > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                              {(s.won + s.lost) > 0 ? `${s.winRate}%` : '—'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
