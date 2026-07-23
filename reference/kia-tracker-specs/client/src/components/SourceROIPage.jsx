import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  DollarSign, Users, Trophy, TrendingUp, Pencil, Check, X, Plus,
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL;

const PERIODS = [
  { value: '30d', labelKey: 'winLoss.period.30d' },
  { value: '90d', labelKey: 'winLoss.period.90d' },
  { value: '6m',  labelKey: 'winLoss.period.6m' },
  { value: '1y',  labelKey: 'winLoss.period.1y' },
  { value: 'all', labelKey: 'winLoss.period.all' },
];

const SOURCE_NAMES = {
  manual: 'Manual', website: 'Website', facebook: 'Facebook', meta_lead_form: 'Meta Lead Form',
  walk_in: 'Walk-In', phone: 'Phone', referral: 'Referral', google_ads: 'Google Ads',
  fluent_form: 'Fluent Form', chatbot: 'Chatbot', instagram: 'Instagram',
  autotrader: 'AutoTrader', cargurus: 'CarGurus', kijiji: 'Kijiji',
  marketplace: 'Marketplace', kia_oem: 'Kia OEM', service: 'Service', unknown: 'Unknown',
};

const BAR_COLORS = ['#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6','#06B6D4','#F97316','#EC4899','#6B7280','#14B8A6'];

function fmt$(n) { return n >= 1000 ? `$${(n/1000).toFixed(1)}k` : `$${n.toFixed(0)}`; }
function fmtPct(n) { return `${n.toFixed(1)}%`; }

function roiColor(roi) {
  if (roi >= 200) return 'text-green-700 bg-green-100';
  if (roi >= 0)   return 'text-yellow-700 bg-yellow-100';
  return 'text-red-700 bg-red-100';
}

function HorizontalBars({ items, valueKey, label, colorIdx }) {
  const max = Math.max(...items.map(i => i[valueKey]), 1);
  return (
    <div className="space-y-2">
      <p className="text-xs font-bold text-gray-700 uppercase">{label}</p>
      {items.map((item, i) => (
        <div key={item.source} className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500 w-24 truncate text-right">{SOURCE_NAMES[item.source] || item.source}</span>
          <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${(item[valueKey] / max) * 100}%`, backgroundColor: BAR_COLORS[(i + (colorIdx || 0)) % BAR_COLORS.length] }}
            />
          </div>
          <span className="text-[10px] font-medium text-gray-600 w-16 text-right">
            {valueKey === 'totalLeads' ? item[valueKey] : fmt$(item[valueKey])}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function SourceROIPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState('90d');
  const [editId, setEditId] = useState(null);
  const [editSpend, setEditSpend] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ source: 'facebook', month: new Date().toISOString().slice(0, 7) + '-01', spend: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['source-roi', period],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/analytics/source-roi?period=${period}`);
      return res.ok ? res.json() : null;
    },
  });

  const currentMonth = new Date().toISOString().slice(0, 7) + '-01';
  const { data: costs = [] } = useQuery({
    queryKey: ['source-costs', currentMonth],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/source-costs?month=${currentMonth}`);
      return res.ok ? res.json() : [];
    },
  });

  const upsertMutation = useMutation({
    mutationFn: async (body) => {
      const res = await fetch(`${API_URL}/source-costs`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['source-costs'] });
      queryClient.invalidateQueries({ queryKey: ['source-roi'] });
      setEditId(null);
      setShowAdd(false);
      setAddForm(f => ({ ...f, spend: '' }));
    },
  });

  const patchMutation = useMutation({
    mutationFn: async ({ id, spend }) => {
      const res = await fetch(`${API_URL}/source-costs/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spend: parseFloat(spend) }),
      });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['source-costs'] });
      queryClient.invalidateQueries({ queryKey: ['source-roi'] });
      setEditId(null);
    },
  });

  const tot = data?.totals;
  const sources = data?.sources || [];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('sourceRoi.title')}</h1>
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
        <p className="text-center py-16 text-gray-400">{t('sourceRoi.noData')}</p>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-8">
            {[
              { label: t('sourceRoi.totalLeads'), value: tot.totalLeads, icon: Users, color: 'text-gray-900' },
              { label: t('sourceRoi.converted'), value: tot.totalConverted, icon: Trophy, color: 'text-green-700' },
              { label: t('sourceRoi.spend'), value: fmt$(tot.totalSpend), icon: DollarSign, color: 'text-red-700' },
              { label: t('sourceRoi.revenue'), value: fmt$(tot.totalRevenue), icon: DollarSign, color: 'text-green-700' },
              { label: t('sourceRoi.costPerLead'), value: fmt$(tot.avgCostPerLead), icon: DollarSign, color: 'text-amber-700' },
              { label: t('sourceRoi.overallRoi'), value: fmtPct(tot.overallROI), icon: TrendingUp, color: tot.overallROI >= 0 ? 'text-green-700' : 'text-red-700' },
            ].map((card, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-200 p-3">
                <div className="flex items-center gap-1.5 text-[10px] font-medium text-gray-500 uppercase mb-1">
                  <card.icon size={12} /> {card.label}
                </div>
                <p className={`text-xl font-bold ${card.color}`}>{card.value}</p>
              </div>
            ))}
          </div>

          {/* Source comparison table */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-8">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-left text-xs font-medium text-gray-500 uppercase">
                    <th className="px-4 py-3">{t('sourceRoi.source')}</th>
                    <th className="px-3 py-3 text-center">Leads</th>
                    <th className="px-3 py-3 text-center">Conv.</th>
                    <th className="px-3 py-3 text-center">Conv %</th>
                    <th className="px-3 py-3 text-right">{t('sourceRoi.spend')}</th>
                    <th className="px-3 py-3 text-right">$/Lead</th>
                    <th className="px-3 py-3 text-right">{t('sourceRoi.revenue')}</th>
                    <th className="px-3 py-3 text-center">ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map(s => (
                    <tr key={s.source} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-2.5 font-medium text-gray-800">{SOURCE_NAMES[s.source] || s.source}</td>
                      <td className="px-3 py-2.5 text-center text-gray-600">{s.totalLeads}</td>
                      <td className="px-3 py-2.5 text-center text-green-600 font-medium">{s.convertedLeads}</td>
                      <td className="px-3 py-2.5 text-center text-gray-600">{fmtPct(s.conversionRate)}</td>
                      <td className="px-3 py-2.5 text-right text-gray-600">{s.totalSpend > 0 ? fmt$(s.totalSpend) : '—'}</td>
                      <td className="px-3 py-2.5 text-right text-gray-600">{s.costPerLead > 0 ? fmt$(s.costPerLead) : '—'}</td>
                      <td className="px-3 py-2.5 text-right text-green-600 font-medium">{s.totalRevenue > 0 ? fmt$(s.totalRevenue) : '—'}</td>
                      <td className="px-3 py-2.5 text-center">
                        {s.totalSpend > 0 ? (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${roiColor(s.roi)}`}>
                            {fmtPct(s.roi)}
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Visual bars */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <HorizontalBars items={sources.filter(s => s.totalLeads > 0)} valueKey="totalLeads" label={t('sourceRoi.totalLeads')} colorIdx={0} />
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <HorizontalBars items={sources.filter(s => s.totalSpend > 0)} valueKey="totalSpend" label={t('sourceRoi.spend')} colorIdx={3} />
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <HorizontalBars items={sources.filter(s => s.totalRevenue > 0)} valueKey="totalRevenue" label={t('sourceRoi.revenue')} colorIdx={1} />
            </div>
          </div>

          {/* Monthly spend input */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-gray-900">{t('sourceRoi.monthlySpend')}</h2>
              <button onClick={() => setShowAdd(true)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700">
                <Plus size={12} /> {t('sourceRoi.addSpend')}
              </button>
            </div>

            {showAdd && (
              <div className="flex gap-2 mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <select value={addForm.source} onChange={e => setAddForm(f => ({ ...f, source: e.target.value }))}
                  className="px-2 py-1.5 rounded border border-gray-200 text-sm flex-1">
                  {Object.entries(SOURCE_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <input type="month" value={addForm.month.slice(0, 7)}
                  onChange={e => setAddForm(f => ({ ...f, month: e.target.value + '-01' }))}
                  className="px-2 py-1.5 rounded border border-gray-200 text-sm" />
                <input type="number" step="0.01" min="0" value={addForm.spend}
                  onChange={e => setAddForm(f => ({ ...f, spend: e.target.value }))}
                  placeholder="$" className="px-2 py-1.5 rounded border border-gray-200 text-sm w-24" />
                <button onClick={() => upsertMutation.mutate({ source: addForm.source, month: addForm.month, spend: parseFloat(addForm.spend) || 0 })}
                  className="px-3 py-1.5 rounded-lg bg-green-600 text-white text-xs font-medium hover:bg-green-700">
                  <Check size={14} />
                </button>
                <button onClick={() => setShowAdd(false)}
                  className="px-2 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100">
                  <X size={14} />
                </button>
              </div>
            )}

            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-gray-500 uppercase border-b border-gray-200">
                  <th className="px-3 py-2">{t('sourceRoi.source')}</th>
                  <th className="px-3 py-2 text-right">{t('sourceRoi.spend')}</th>
                  <th className="px-3 py-2 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {costs.map(c => (
                  <tr key={c.id} className="border-b border-gray-50">
                    <td className="px-3 py-2.5 font-medium text-gray-700">{SOURCE_NAMES[c.source] || c.source}</td>
                    <td className="px-3 py-2.5 text-right">
                      {editId === c.id ? (
                        <input type="number" step="0.01" value={editSpend}
                          onChange={e => setEditSpend(e.target.value)}
                          className="w-24 px-2 py-1 rounded border border-blue-300 text-sm text-right"
                          onKeyDown={e => e.key === 'Enter' && patchMutation.mutate({ id: c.id, spend: editSpend })} />
                      ) : (
                        <span className="text-gray-600">${Number(c.spend).toFixed(2)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {editId === c.id ? (
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => patchMutation.mutate({ id: c.id, spend: editSpend })}
                            className="p-1 rounded text-green-600 hover:bg-green-50"><Check size={14} /></button>
                          <button onClick={() => setEditId(null)}
                            className="p-1 rounded text-gray-400 hover:bg-gray-100"><X size={14} /></button>
                        </div>
                      ) : (
                        <button onClick={() => { setEditId(c.id); setEditSpend(String(c.spend)); }}
                          className="p-1 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50">
                          <Pencil size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {costs.length === 0 && (
                  <tr><td colSpan={3} className="text-center py-6 text-xs text-gray-400">{t('sourceRoi.noData')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
