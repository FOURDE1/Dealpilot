import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';

const API_URL = import.meta.env.VITE_API_URL;

function MetricCard({ label, value, color = 'text-gray-900' }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
    </div>
  );
}

function fmt(num) {
  return Number(num || 0).toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
}

export default function SalesPerformance({ period }) {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`${API_URL}/reports/sales-performance?period=${period}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [period]);

  const handleExport = (format) => {
    window.open(`${API_URL}/reports/export/${format}?type=sales&period=${period}`, '_blank');
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600" />
      </div>
    );
  }

  if (!data) return <p className="text-gray-500 py-8 text-center">{t('common.error')}</p>;

  const { summary, salespeople, monthlyTrend, weeklyTrend } = data;
  const trendData = period === 'weekly' ? weeklyTrend : monthlyTrend;

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

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <MetricCard label={t('reports.totalDeals')} value={summary.totalDeals} />
        <MetricCard label={t('reports.completedDeals')} value={summary.completedDeals} />
        <MetricCard label={t('reports.conversionRate')} value={`${summary.conversionRate}%`} color="text-blue-600" />
        <MetricCard label={t('reports.totalGross')} value={fmt(summary.totalGross)} color="text-green-600" />
        <MetricCard label={t('reports.avgGross')} value={fmt(summary.avgGrossPerDeal)} />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bar Chart - Deals by Person */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">{t('reports.dealsBySalesperson')}</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={salespeople} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => [v, 'Deals']} />
              <Bar dataKey="deals" fill="#1e3a5f" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Line Chart - Trend */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">{t('reports.grossTrend')}</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={period === 'weekly' ? 'week' : 'month'} tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v) => [fmt(v), 'Gross']} />
              <Line type="monotone" dataKey="totalGross" stroke="#c4342d" strokeWidth={2} dot={{ fill: '#c4342d' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Leaderboard Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 bg-[#1e3a5f]">
          <h3 className="text-sm font-semibold text-white">{t('reports.leaderboard')}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">#</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('reports.salesperson')}</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t('reports.deals')}</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t('reports.completed')}</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t('reports.totalSales')}</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t('reports.grossProfit')}</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t('reports.fiReserve')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {salespeople.map((sp, i) => (
                <tr key={sp.name} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-4 py-3 text-sm font-medium text-gray-500">{i + 1}</td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{sp.name}</td>
                  <td className="px-4 py-3 text-sm text-right text-gray-700">{sp.deals}</td>
                  <td className="px-4 py-3 text-sm text-right text-gray-700">{sp.completed}</td>
                  <td className="px-4 py-3 text-sm text-right text-gray-700">{fmt(sp.totalSales)}</td>
                  <td className="px-4 py-3 text-sm text-right font-medium text-green-700">{fmt(sp.totalGross)}</td>
                  <td className="px-4 py-3 text-sm text-right text-gray-700">{fmt(sp.totalFI)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
