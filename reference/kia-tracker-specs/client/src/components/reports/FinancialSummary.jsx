import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const API_URL = import.meta.env.VITE_API_URL;

function fmt(num) {
  return Number(num || 0).toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
}

const COLORS = ['#1e3a5f', '#c4342d', '#2d6a4f', '#7b2d8b'];

export default function FinancialSummary({ period }) {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`${API_URL}/reports/financial-summary?period=${period}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [period]);

  const handleExport = (format) => {
    window.open(`${API_URL}/reports/export/${format}?type=financial&period=${period}`, '_blank');
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-purple-600" />
      </div>
    );
  }

  if (!data) return <p className="text-gray-500 py-8 text-center">{t('common.error')}</p>;

  const { summary, moneyFlow, breakdown, monthlyTrend } = data;

  const pieData = [
    { name: t('saleType.retail'), value: breakdown.retail.count },
    { name: t('saleType.wholesale'), value: breakdown.wholesale.count },
  ].filter((d) => d.value > 0);

  return (
    <div className="space-y-6">
      {/* Export buttons */}
      <div className="flex justify-end gap-2">
        <button onClick={() => handleExport('excel')} className="px-3 py-1.5 text-xs font-medium rounded-md bg-green-600 text-white hover:bg-green-700">
          {t('reports.exportExcel')}
        </button>
        <button onClick={() => handleExport('pdf')} className="px-3 py-1.5 text-xs font-medium rounded-md bg-red-600 text-white hover:bg-red-700">
          {t('reports.exportPDF')}
        </button>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <p className="text-xs text-gray-500">{t('reports.totalSales')}</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{fmt(summary.totalSales)}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <p className="text-xs text-gray-500">{t('reports.totalCost')}</p>
          <p className="text-xl font-bold text-red-600 mt-1">{fmt(summary.totalCost)}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <p className="text-xs text-gray-500">{t('reports.grossProfit')}</p>
          <p className="text-xl font-bold text-green-600 mt-1">{fmt(summary.totalGross)}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <p className="text-xs text-gray-500">{t('reports.fiReserve')}</p>
          <p className="text-xl font-bold text-blue-600 mt-1">{fmt(summary.totalFI)}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <p className="text-xs text-gray-500">{t('reports.netGross')}</p>
          <p className="text-xl font-bold text-green-700 mt-1">{fmt(summary.totalNet)}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <p className="text-xs text-gray-500">{t('reports.avgGross')}</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{fmt(summary.avgGrossPerDeal)}</p>
        </div>
      </div>

      {/* Money Flow + Pie Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Money Flow */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">{t('reports.moneyFlow')}</h3>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-600">{t('reports.moneyDown')}</span>
                <span className="font-medium">{fmt(moneyFlow.moneyDownTotal)}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div
                  className="bg-green-500 h-3 rounded-full transition-all"
                  style={{ width: moneyFlow.moneyDownTotal > 0 ? `${(moneyFlow.moneyDownCollected / moneyFlow.moneyDownTotal * 100)}%` : '0%' }}
                />
              </div>
              <div className="flex justify-between text-xs mt-1 text-gray-500">
                <span>{t('reports.collected')}: {fmt(moneyFlow.moneyDownCollected)}</span>
                <span>{t('reports.outstanding')}: {fmt(moneyFlow.moneyDownOutstanding)}</span>
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-600">{t('reports.cashBack')}</span>
                <span className="font-medium">{fmt(moneyFlow.cashBackTotal)}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div
                  className="bg-blue-500 h-3 rounded-full transition-all"
                  style={{ width: moneyFlow.cashBackTotal > 0 ? `${(moneyFlow.cashBackSent / moneyFlow.cashBackTotal * 100)}%` : '0%' }}
                />
              </div>
              <div className="flex justify-between text-xs mt-1 text-gray-500">
                <span>{t('reports.sent')}: {fmt(moneyFlow.cashBackSent)}</span>
                <span>{t('reports.pending')}: {fmt(moneyFlow.cashBackPending)}</span>
              </div>
            </div>
            <div className="pt-2 border-t border-gray-100">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">{t('reports.totalLiens')}</span>
                <span className="font-medium text-orange-600">{fmt(moneyFlow.lienTotal)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Retail vs Wholesale */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">{t('reports.retailVsWholesale')}</h3>
          {pieData.length > 0 ? (
            <div className="flex items-center justify-center">
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-gray-400 text-center py-8">{t('common.noResults')}</p>
          )}
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div className="text-center p-3 bg-indigo-50 rounded-lg">
              <p className="text-sm text-gray-600">{t('saleType.retail')}</p>
              <p className="text-lg font-bold text-indigo-700">{breakdown.retail.count} {t('reports.deals')}</p>
              <p className="text-xs text-gray-500">{fmt(breakdown.retail.totalGross)} {t('reports.gross')}</p>
            </div>
            <div className="text-center p-3 bg-orange-50 rounded-lg">
              <p className="text-sm text-gray-600">{t('saleType.wholesale')}</p>
              <p className="text-lg font-bold text-orange-700">{breakdown.wholesale.count} {t('reports.deals')}</p>
              <p className="text-xs text-gray-500">{fmt(breakdown.wholesale.totalGross)} {t('reports.gross')}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Monthly Trend Chart */}
      {monthlyTrend.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">{t('reports.monthlyRevenue')}</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={monthlyTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v, name) => [fmt(v), name === 'gross' ? 'Gross' : name === 'fi' ? 'F&I' : name]} />
              <Bar dataKey="gross" name="Gross Profit" fill="#2d6a4f" stackId="a" />
              <Bar dataKey="fi" name="F&I Reserve" fill="#7b2d8b" stackId="a" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
