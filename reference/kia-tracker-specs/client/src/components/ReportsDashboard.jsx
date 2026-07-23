import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import SalesPerformance from './reports/SalesPerformance';
import CommissionTracker from './reports/CommissionTracker';
import FinancialSummary from './reports/FinancialSummary';
import InventoryPipeline from './reports/InventoryPipeline';

const TABS = ['sales', 'commissions', 'financial', 'inventory'];
const PERIODS = ['weekly', 'monthly', 'ytd'];

export default function ReportsDashboard() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('sales');
  const [period, setPeriod] = useState('ytd');

  const tabColors = {
    sales: 'border-blue-500 text-blue-600',
    commissions: 'border-green-500 text-green-600',
    financial: 'border-purple-500 text-purple-600',
    inventory: 'border-orange-500 text-orange-600',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900">{t('reports.title')}</h1>
        <div className="flex items-center gap-2">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                period === p
                  ? 'bg-[#1e3a5f] text-white'
                  : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
              }`}
            >
              {t(`reports.period.${p}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8 overflow-x-auto" aria-label="Tabs">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === tab
                  ? tabColors[tab]
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {t(`reports.tabs.${tab}`)}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'sales' && <SalesPerformance period={period} />}
      {activeTab === 'commissions' && <CommissionTracker period={period} />}
      {activeTab === 'financial' && <FinancialSummary period={period} />}
      {activeTab === 'inventory' && <InventoryPipeline />}
    </div>
  );
}
