import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const API_URL = import.meta.env.VITE_API_URL;

function fmt(num) {
  return Number(num || 0).toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
}

export default function CommissionTracker({ period }) {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`${API_URL}/reports/commissions?period=${period}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [period]);

  const handleExport = (format) => {
    window.open(`${API_URL}/reports/export/${format}?type=commissions&period=${period}`, '_blank');
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-green-600" />
      </div>
    );
  }

  if (!data) return <p className="text-gray-500 py-8 text-center">{t('common.error')}</p>;

  const { salespeople, monthlyBreakdown } = data;
  const totalCommissions = salespeople.reduce((s, sp) => s + sp.totalCommission + sp.totalOverrides, 0);

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

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <p className="text-sm text-gray-500">{t('reports.totalCommissions')}</p>
          <p className="text-2xl font-bold text-green-600 mt-1">{fmt(totalCommissions)}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <p className="text-sm text-gray-500">{t('reports.salespeople')}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{salespeople.length}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <p className="text-sm text-gray-500">{t('reports.totalDeals')}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{salespeople.reduce((s, sp) => s + sp.deals, 0)}</p>
        </div>
      </div>

      {/* Monthly Commission Chart */}
      {monthlyBreakdown.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">{t('reports.monthlyCommissions')}</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={monthlyBreakdown}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v) => [fmt(v), 'Commission']} />
              <Bar dataKey="total" fill="#2d6a4f" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Commission Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 bg-[#2d6a4f]">
          <h3 className="text-sm font-semibold text-white">{t('reports.commissionBreakdown')}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('reports.salesperson')}</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t('reports.deals')}</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t('reports.rate')}</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t('reports.pad')}</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t('reports.grossForCommission')}</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t('reports.commission')}</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t('reports.overrides')}</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t('reports.totalEarned')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {salespeople.map((sp, i) => (
                <tr key={sp.name} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{sp.name}</td>
                  <td className="px-4 py-3 text-sm text-right text-gray-700">{sp.deals}</td>
                  <td className="px-4 py-3 text-sm text-right text-gray-700">{(sp.rate * 100).toFixed(0)}%</td>
                  <td className="px-4 py-3 text-sm text-right text-gray-700">{fmt(sp.padAmount)}</td>
                  <td className="px-4 py-3 text-sm text-right text-gray-700">{fmt(sp.totalGrossForCommission)}</td>
                  <td className="px-4 py-3 text-sm text-right font-medium text-green-700">{fmt(sp.totalCommission)}</td>
                  <td className="px-4 py-3 text-sm text-right text-blue-600">{fmt(sp.totalOverrides)}</td>
                  <td className="px-4 py-3 text-sm text-right font-bold text-gray-900">{fmt(sp.totalCommission + sp.totalOverrides)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-100">
              <tr>
                <td className="px-4 py-3 text-sm font-bold text-gray-900">{t('reports.total')}</td>
                <td className="px-4 py-3 text-sm text-right font-bold">{salespeople.reduce((s, sp) => s + sp.deals, 0)}</td>
                <td colSpan={3}></td>
                <td className="px-4 py-3 text-sm text-right font-bold text-green-700">{fmt(salespeople.reduce((s, sp) => s + sp.totalCommission, 0))}</td>
                <td className="px-4 py-3 text-sm text-right font-bold text-blue-600">{fmt(salespeople.reduce((s, sp) => s + sp.totalOverrides, 0))}</td>
                <td className="px-4 py-3 text-sm text-right font-bold text-gray-900">{fmt(totalCommissions)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
