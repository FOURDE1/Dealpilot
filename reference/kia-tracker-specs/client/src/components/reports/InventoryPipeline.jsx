import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

const API_URL = import.meta.env.VITE_API_URL;

const STATUS_COLORS = {
  incoming: { bg: 'bg-yellow-100', text: 'text-yellow-800', bar: 'bg-yellow-400' },
  at_garage: { bg: 'bg-blue-100', text: 'text-blue-800', bar: 'bg-blue-400' },
  delivered: { bg: 'bg-green-100', text: 'text-green-800', bar: 'bg-green-400' },
  pending: { bg: 'bg-yellow-100', text: 'text-yellow-800', bar: 'bg-yellow-400' },
  approved: { bg: 'bg-blue-100', text: 'text-blue-800', bar: 'bg-blue-400' },
  funded: { bg: 'bg-green-100', text: 'text-green-800', bar: 'bg-green-400' },
};

function FunnelBar({ label, count, total, color }) {
  const pct = total > 0 ? (count / total * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-gray-600 w-24 text-right">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-6 relative">
        <div
          className={`${color} h-6 rounded-full transition-all flex items-center justify-end pr-2`}
          style={{ width: `${Math.max(pct, 5)}%` }}
        >
          <span className="text-xs font-bold text-white">{count}</span>
        </div>
      </div>
      <span className="text-xs text-gray-400 w-12">{pct.toFixed(0)}%</span>
    </div>
  );
}

export default function InventoryPipeline() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`${API_URL}/reports/inventory-pipeline`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const handleExport = (format) => {
    window.open(`${API_URL}/reports/export/${format}?type=inventory&period=ytd`, '_blank');
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-orange-600" />
      </div>
    );
  }

  if (!data) return <p className="text-gray-500 py-8 text-center">{t('common.error')}</p>;

  const { vehicleStatus, financeStatus, avgDaysToDelivery, aging, bottlenecks, totalActive } = data;

  const agingWarning = (days) => {
    if (days > 60) return 'bg-red-50 border-red-200';
    if (days > 30) return 'bg-yellow-50 border-yellow-200';
    return '';
  };

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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <p className="text-sm text-gray-500">{t('reports.totalActive')}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{totalActive}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <p className="text-sm text-gray-500">{t('reports.avgDaysToDelivery')}</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">{avgDaysToDelivery} {t('reports.days')}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <p className="text-sm text-gray-500">{t('reports.notFunded')}</p>
          <p className="text-2xl font-bold text-red-600 mt-1">{bottlenecks.not_funded}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <p className="text-sm text-gray-500">{t('reports.noDeliveryDate')}</p>
          <p className="text-2xl font-bold text-orange-600 mt-1">{bottlenecks.no_delivery_date}</p>
        </div>
      </div>

      {/* Pipeline Funnels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Vehicle Status Funnel */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">{t('reports.vehiclePipeline')}</h3>
          <div className="space-y-3">
            <FunnelBar label={t('status.vehicle.incoming')} count={vehicleStatus.incoming} total={totalActive} color="bg-yellow-400" />
            <FunnelBar label={t('status.vehicle.at_garage')} count={vehicleStatus.at_garage} total={totalActive} color="bg-blue-400" />
            <FunnelBar label={t('status.vehicle.delivered')} count={vehicleStatus.delivered} total={totalActive} color="bg-green-400" />
          </div>
        </div>

        {/* Finance Status Funnel */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">{t('reports.financePipeline')}</h3>
          <div className="space-y-3">
            <FunnelBar label={t('status.finance.pending')} count={financeStatus.pending} total={totalActive} color="bg-yellow-400" />
            <FunnelBar label={t('status.finance.approved')} count={financeStatus.approved} total={totalActive} color="bg-blue-400" />
            <FunnelBar label={t('status.finance.funded')} count={financeStatus.funded} total={totalActive} color="bg-green-400" />
          </div>
        </div>
      </div>

      {/* Bottleneck Alerts */}
      {(bottlenecks.not_funded > 0 || bottlenecks.no_delivery_date > 0 || bottlenecks.licensing_incomplete > 0) && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-red-800 mb-2">{t('reports.bottlenecks')}</h3>
          <ul className="text-sm text-red-700 space-y-1">
            {bottlenecks.not_funded > 0 && (
              <li>{bottlenecks.not_funded} {t('reports.deliveredNotFunded')}</li>
            )}
            {bottlenecks.no_delivery_date > 0 && (
              <li>{bottlenecks.no_delivery_date} {t('reports.openNoDeliveryDate')}</li>
            )}
            {bottlenecks.licensing_incomplete > 0 && (
              <li>{bottlenecks.licensing_incomplete} {t('reports.licensingIncomplete')}</li>
            )}
          </ul>
        </div>
      )}

      {/* Aging Inventory Table */}
      {aging.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 bg-[#b45309]">
            <h3 className="text-sm font-semibold text-white">{t('reports.agingInventory')}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('deal.fields.stockNumber')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('reports.vehicle')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('reports.customer')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('reports.salesperson')}</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">{t('reports.status')}</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t('reports.daysOld')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {aging.slice(0, 50).map((item) => (
                  <tr
                    key={item.id}
                    onClick={() => navigate(`/deal/${item.id}`)}
                    className={`cursor-pointer hover:bg-gray-100 ${agingWarning(item.days_old)}`}
                  >
                    <td className="px-4 py-3 text-sm font-mono text-gray-600">{item.stock_number || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-900">{item.vehicle || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{item.customer || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{item.salesperson || '-'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[item.vehicle_status]?.bg || ''} ${STATUS_COLORS[item.vehicle_status]?.text || ''}`}>
                        {item.vehicle_status ? t(`status.vehicle.${item.vehicle_status}`) : '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-right">
                      <span className={`font-bold ${item.days_old > 60 ? 'text-red-600' : item.days_old > 30 ? 'text-yellow-600' : 'text-gray-700'}`}>
                        {item.days_old}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
