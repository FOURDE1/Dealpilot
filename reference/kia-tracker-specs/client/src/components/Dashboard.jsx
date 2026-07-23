import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../supabaseClient';

const API_URL = import.meta.env.VITE_API_URL;

const VEHICLE_STATUS_COLORS = {
  incoming: 'bg-yellow-100 text-yellow-800',
  at_garage: 'bg-blue-100 text-blue-800',
  delivered: 'bg-green-100 text-green-800',
};

const FINANCE_STATUS_COLORS = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-blue-100 text-blue-800',
  funded: 'bg-green-100 text-green-800',
};

const SALE_TYPE_COLORS = {
  retail: 'bg-indigo-100 text-indigo-800',
  wholesale: 'bg-orange-100 text-orange-800',
};

const STAT_STYLES = [
  { key: 'totalUnits', border: 'border-l-blue-500', bg: 'bg-blue-50', text: 'text-blue-700' },
  { key: 'delivered', border: 'border-l-green-500', bg: 'bg-green-50', text: 'text-green-700' },
  { key: 'pending', border: 'border-l-yellow-500', bg: 'bg-yellow-50', text: 'text-yellow-700' },
  { key: 'funded', border: 'border-l-emerald-500', bg: 'bg-emerald-50', text: 'text-emerald-700' },
  { key: 'retail', border: 'border-l-indigo-500', bg: 'bg-indigo-50', text: 'text-indigo-700' },
  { key: 'wholesale', border: 'border-l-orange-500', bg: 'bg-orange-50', text: 'text-orange-700' },
  { key: 'listedOnline', border: 'border-l-purple-500', bg: 'bg-purple-50', text: 'text-purple-700' },
];

const INITIAL_FILTERS = {
  search: '',
  salesperson: '',
  vehicleStatus: '',
  financeStatus: '',
  saleType: '',
  province: '',
  listedOnline: '',
  dateFrom: '',
  dateTo: '',
};

export default function Dashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [deals, setDeals] = useState([]);
  const [stats, setStats] = useState(null);
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [salespersons, setSalespersons] = useState([]);

  // Build query params from active filters
  const buildQueryParams = useCallback(() => {
    const params = new URLSearchParams();
    if (filters.search) params.set('search', filters.search);
    if (filters.salesperson) params.set('salesperson', filters.salesperson);
    if (filters.vehicleStatus) params.set('vehicleStatus', filters.vehicleStatus);
    if (filters.financeStatus) params.set('financeStatus', filters.financeStatus);
    if (filters.saleType) params.set('saleType', filters.saleType);
    if (filters.province) params.set('province', filters.province);
    if (filters.listedOnline) params.set('listedOnline', filters.listedOnline);
    if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo) params.set('dateTo', filters.dateTo);
    return params.toString();
  }, [filters]);

  // Fetch deals
  const fetchDeals = useCallback(async () => {
    try {
      const query = buildQueryParams();
      const url = `${API_URL}/deals${query ? `?${query}` : ''}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch deals');
      const data = await res.json();
      setDeals(data);

      // Extract unique salespersons for filter dropdown
      const names = [...new Set(data.map((d) => d.salesperson_name).filter(Boolean))].sort();
      setSalespersons(names);
    } catch (err) {
      console.error('Error fetching deals:', err);
    }
  }, [buildQueryParams]);

  // Fetch stats
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/deals/stats/summary`);
      if (!res.ok) throw new Error('Failed to fetch stats');
      const data = await res.json();
      // Map API response keys to component keys
      setStats({
        totalUnits: data.total,
        delivered: data.delivered,
        pending: data.pending,
        funded: data.funded,
        retail: data.retail,
        wholesale: data.wholesale,
        listedOnline: data.listed_online,
      });
    } catch (err) {
      console.error('Error fetching stats:', err);
    }
  }, []);

  // Initial load and filter changes
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([fetchDeals(), fetchStats()]);
      setLoading(false);
    };
    load();
  }, [fetchDeals, fetchStats]);

  // Supabase realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('deals-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deals' }, () => {
        fetchDeals();
        fetchStats();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchDeals, fetchStats]);

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const clearFilters = () => {
    setFilters(INITIAL_FILTERS);
  };

  const hasActiveFilters = Object.values(filters).some((v) => v !== '');

  // Stat card helper
  const renderStatCard = (style, value) => (
    <div
      key={style.key}
      className={`border-l-4 ${style.border} ${style.bg} rounded-lg p-4 flex flex-col min-w-0`}
    >
      <span className="text-sm font-medium text-gray-500 truncate">
        {t(`dashboard.stats.${style.key}`)}
      </span>
      <span className={`text-2xl font-bold ${style.text} mt-1`}>
        {value ?? '--'}
      </span>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900">{t('dashboard.title')}</h1>
        <button
          onClick={() => navigate('/deal/new')}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          {t('dashboard.newDeal')}
        </button>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
        {STAT_STYLES.map((style) =>
          renderStatCard(style, stats ? stats[style.key] : null)
        )}
      </div>

      {/* Filter Bar */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        {/* Mobile toggle */}
        <button
          onClick={() => setFiltersOpen((prev) => !prev)}
          className="w-full flex items-center justify-between p-4 md:hidden text-sm font-medium text-gray-700"
        >
          <span className="flex items-center gap-2">
            <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
            </svg>
            {t('filters.search')}
            {hasActiveFilters && (
              <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-red-500 rounded-full">
                !
              </span>
            )}
          </span>
          <svg
            className={`h-5 w-5 text-gray-400 transition-transform ${filtersOpen ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>

        {/* Filter fields */}
        <div className={`p-4 space-y-4 ${filtersOpen ? 'block' : 'hidden'} md:block`}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Search */}
            <div className="sm:col-span-2 lg:col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">
                {t('filters.search')}
              </label>
              <input
                type="text"
                value={filters.search}
                onChange={(e) => handleFilterChange('search', e.target.value)}
                placeholder={t('filters.searchPlaceholder')}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-none"
              />
            </div>

            {/* Salesperson */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                {t('filters.salesperson')}
              </label>
              <select
                value={filters.salesperson}
                onChange={(e) => handleFilterChange('salesperson', e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-none bg-white"
              >
                <option value="">{t('filters.all')}</option>
                {salespersons.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>

            {/* Vehicle Status */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                {t('deal.fields.vehicleStatus')}
              </label>
              <select
                value={filters.vehicleStatus}
                onChange={(e) => handleFilterChange('vehicleStatus', e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-none bg-white"
              >
                <option value="">{t('filters.all')}</option>
                <option value="incoming">{t('status.vehicle.incoming')}</option>
                <option value="at_garage">{t('status.vehicle.at_garage')}</option>
                <option value="delivered">{t('status.vehicle.delivered')}</option>
              </select>
            </div>

            {/* Finance Status */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                {t('deal.fields.financeStatus')}
              </label>
              <select
                value={filters.financeStatus}
                onChange={(e) => handleFilterChange('financeStatus', e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-none bg-white"
              >
                <option value="">{t('filters.all')}</option>
                <option value="pending">{t('status.finance.pending')}</option>
                <option value="approved">{t('status.finance.approved')}</option>
                <option value="funded">{t('status.finance.funded')}</option>
              </select>
            </div>

            {/* Sale Type */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                {t('filters.saleType')}
              </label>
              <select
                value={filters.saleType}
                onChange={(e) => handleFilterChange('saleType', e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-none bg-white"
              >
                <option value="">{t('filters.all')}</option>
                <option value="retail">{t('saleType.retail')}</option>
                <option value="wholesale">{t('saleType.wholesale')}</option>
              </select>
            </div>

            {/* Province */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                {t('filters.province')}
              </label>
              <select
                value={filters.province}
                onChange={(e) => handleFilterChange('province', e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-none bg-white"
              >
                <option value="">{t('filters.all')}</option>
                <option value="ontario">{t('province.ontario')}</option>
                <option value="quebec">{t('province.quebec')}</option>
                <option value="other">{t('province.other')}</option>
              </select>
            </div>

            {/* Listed Online */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                {t('filters.listedOnline')}
              </label>
              <select
                value={filters.listedOnline}
                onChange={(e) => handleFilterChange('listedOnline', e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-none bg-white"
              >
                <option value="">{t('filters.all')}</option>
                <option value="yes">{t('common.yes')}</option>
                <option value="no">{t('common.no')}</option>
              </select>
            </div>

            {/* Date From */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                {t('filters.startDate')}
              </label>
              <input
                type="date"
                value={filters.dateFrom}
                onChange={(e) => handleFilterChange('dateFrom', e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-none"
              />
            </div>

            {/* Date To */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                {t('filters.endDate')}
              </label>
              <input
                type="date"
                value={filters.dateTo}
                onChange={(e) => handleFilterChange('dateTo', e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-none"
              />
            </div>

            {/* Clear Filters */}
            <div className="flex items-end">
              <button
                onClick={clearFilters}
                disabled={!hasActiveFilters}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {t('filters.clear')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Deal Cards Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-red-600" />
            <span className="text-sm text-gray-500">{t('common.loading')}</span>
          </div>
        </div>
      ) : deals.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <svg className="h-16 w-16 text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12H9.75m3 0h.008v.008H12.75V15zm-3 3h.008v.008H9.75V18zm0-6h.008v.008H9.75V12zM12 2.25c-4.97 0-9 2.015-9 4.5v10.5c0 2.485 4.03 4.5 9 4.5s9-2.015 9-4.5V6.75c0-2.485-4.03-4.5-9-4.5z" />
          </svg>
          <p className="text-gray-500 text-lg font-medium">{t('dashboard.noDeals')}</p>
          <button
            onClick={() => navigate('/deal/new')}
            className="mt-4 text-sm text-red-600 hover:text-red-700 font-medium"
          >
            {t('dashboard.newDeal')} &rarr;
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {deals.map((deal) => (
            <div
              key={deal.id}
              onClick={() => navigate(`/deal/${deal.id}`)}
              className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 cursor-pointer hover:shadow-md hover:border-gray-300 transition-all group"
            >
              {/* Card Header */}
              <div className="flex items-start justify-between mb-3">
                <div className="min-w-0">
                  <p className="text-xs font-mono text-gray-400 uppercase tracking-wide">
                    #{deal.stock_number || '--'}
                  </p>
                  <h3 className="text-sm font-semibold text-gray-900 mt-0.5 truncate group-hover:text-red-600 transition-colors">
                    {[deal.year, deal.make, deal.model].filter(Boolean).join(' ') || '--'}
                  </h3>
                  {deal.color && (
                    <p className="text-xs text-gray-400 mt-0.5">{deal.color}</p>
                  )}
                </div>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium shrink-0 ml-2 ${
                    SALE_TYPE_COLORS[deal.sale_type] || 'bg-gray-100 text-gray-800'
                  }`}
                >
                  {deal.sale_type
                    ? t(`saleType.${deal.sale_type}`)
                    : '--'}
                </span>
              </div>

              {/* Customer & Salesperson */}
              <div className="space-y-1.5 mb-3">
                <div className="flex items-center gap-2 text-sm">
                  <svg className="h-4 w-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                  </svg>
                  <span className="text-gray-700 truncate">
                    {deal.customer_name || '--'}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <svg className="h-4 w-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                  <span className="text-gray-500 truncate">
                    {deal.salesperson_name || '--'}
                  </span>
                </div>
              </div>

              {/* Status Badges */}
              <div className="flex flex-wrap gap-2">
                {deal.vehicle_status && (
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      VEHICLE_STATUS_COLORS[deal.vehicle_status] || 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {t(`status.vehicle.${deal.vehicle_status}`)}
                  </span>
                )}
                {deal.finance_status && (
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      FINANCE_STATUS_COLORS[deal.finance_status] || 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {t(`status.finance.${deal.finance_status}`)}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
