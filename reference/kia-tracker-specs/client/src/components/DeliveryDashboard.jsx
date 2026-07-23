import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../supabaseClient';

const API_URL = import.meta.env.VITE_API_URL;

export default function DeliveryDashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/delivery-checklists/dashboard`);
      if (!res.ok) throw new Error('Failed to fetch delivery dashboard');
      const data = await res.json();
      setItems(data);
    } catch (err) {
      console.error('Error fetching delivery dashboard:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  // Supabase realtime
  useEffect(() => {
    const channel = supabase
      .channel('delivery-dashboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_checklists' }, () => {
        fetchDashboard();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deals' }, () => {
        fetchDashboard();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchDashboard]);

  const incompleteCount = items.filter((item) => !item.is_ready).length;

  // Format date for display
  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatDateTime = (dateStr) => {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  // Status indicator circle
  const StatusCircle = ({ done }) => (
    <span
      className={`inline-block h-3 w-3 rounded-full shrink-0 ${
        done ? 'bg-green-500' : 'bg-red-500'
      }`}
    />
  );

  // Flag icon SVG
  const FlagIcon = ({ className }) => (
    <svg
      className={className}
      fill="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M4 24V0h1v1c2 0 3.5.5 5 1s3 1 5 1c3 0 5-1.5 5-1.5V14s-2 1.5-5 1.5c-2 0-3.5-.5-5-1s-3-1-5-1v10.5H4z" />
    </svg>
  );

  // Green checkmark icon
  const CheckIcon = ({ className }) => (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2.5}
      stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('delivery.title')}</h1>
          {!loading && incompleteCount > 0 && (
            <p className="text-sm text-red-600 mt-1">
              {incompleteCount} {t('delivery.incomplete')}
            </p>
          )}
        </div>
      </div>

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-red-600" />
            <span className="text-sm text-gray-500">{t('common.loading')}</span>
          </div>
        </div>
      ) : items.length === 0 ? (
        /* Empty state */
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <svg className="h-16 w-16 text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
          </svg>
          <p className="text-gray-500 text-lg font-medium">{t('delivery.noDeliveries')}</p>
        </div>
      ) : (
        /* Cards grid */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {items.map((item) => {
            const deal = item;
            const ready = item.is_ready;
            const missing = item.missing_items || [];

            return (
              <div
                key={item.id || deal.id}
                onClick={() => navigate(`/deal/${deal.id}`)}
                className={`bg-white rounded-lg shadow-sm border border-gray-200 p-5 cursor-pointer hover:shadow-md hover:border-gray-300 transition-all border-l-4 ${
                  ready ? 'border-l-green-500' : 'border-l-red-500'
                }`}
              >
                {/* Card header: status icon + vehicle info */}
                <div className="flex items-start justify-between mb-3">
                  <div className="min-w-0">
                    <p className="text-xs font-mono text-gray-400 uppercase tracking-wide">
                      #{deal.stock_number || '--'}
                    </p>
                    <h3 className="text-sm font-semibold text-gray-900 mt-0.5 truncate">
                      {[deal.year, deal.make, deal.model].filter(Boolean).join(' ') || '--'}
                    </h3>
                    <p className="text-sm text-gray-700 mt-0.5 truncate">
                      {deal.customer_name || '--'}
                    </p>
                  </div>
                  <div className="shrink-0 ml-2">
                    {ready ? (
                      <CheckIcon className="h-6 w-6 text-green-500" />
                    ) : (
                      <FlagIcon className="h-5 w-5 text-red-500" />
                    )}
                  </div>
                </div>

                {/* Tentative delivery date */}
                <div className="mb-3 bg-gray-50 rounded-md px-3 py-2">
                  <span className="text-xs text-gray-500 font-medium">{t('delivery.deliveryTime')}</span>
                  <p className="text-sm font-semibold text-gray-900">
                    {formatDate(item.tentative_delivery_date || deal.tentative_delivery_date)}
                  </p>
                </div>

                {/* 4-item checklist */}
                <div className="space-y-1.5 mb-3">
                  <div className="flex items-center gap-2 text-sm">
                    <StatusCircle done={item.client_insurance_uploaded} />
                    <span className="text-gray-700">{t('delivery.insurance')}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <StatusCircle done={item.deal_funded} />
                    <span className="text-gray-700">{t('delivery.funded')}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <StatusCircle done={item.safety_done} />
                    <span className="text-gray-700">{t('delivery.safetyDone')}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <StatusCircle done={item.registration_done} />
                    <span className="text-gray-700">{t('delivery.registrationDone')}</span>
                  </div>
                </div>

                {/* Missing items (red flag) */}
                {!ready && missing.length > 0 && (
                  <div className="mb-3">
                    <p className="text-xs font-semibold text-red-600">
                      {t('delivery.redFlag')}: {missing.join(', ')}
                    </p>
                  </div>
                )}

                {/* Booking info */}
                {(item.driver_names || item.booking_company || item.booked_delivery_time) && (
                  <div className="border-t border-gray-100 pt-2 mt-2 space-y-1 text-xs text-gray-500">
                    {item.driver_names && (
                      <p>
                        <span className="font-medium">{t('delivery.driverNames')}:</span> {item.driver_names}
                      </p>
                    )}
                    {item.booking_company && (
                      <p>
                        <span className="font-medium">{t('delivery.bookingCompany')}:</span> {item.booking_company}
                      </p>
                    )}
                    {item.booked_delivery_time && (
                      <p>
                        <span className="font-medium">{t('delivery.deliveryTime')}:</span>{' '}
                        {formatDateTime(item.booked_delivery_time)}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
