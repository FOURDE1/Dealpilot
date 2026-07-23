import { useTranslation } from 'react-i18next';

const STATUS_COLORS = {
  pending: 'bg-yellow-100 text-yellow-800',
  assigned: 'bg-blue-100 text-blue-800',
  in_transit: 'bg-purple-100 text-purple-800',
  completed: 'bg-green-100 text-green-800',
};

export default function DispatchCard({ assignment, onComplete }) {
  const { t } = useTranslation();

  const { num_drivers_needed, dispatch_company, has_trade_in, status, conflict_flag, conflict_reason, deal, chaser, plate } = assignment;

  const vehicle = deal
    ? [deal.year, deal.make, deal.model].filter(Boolean).join(' ')
    : '-';

  return (
    <div
      className={`bg-white rounded-lg shadow-sm border p-4 space-y-3 ${
        conflict_flag ? 'border-red-400 ring-1 ring-red-200' : 'border-gray-200'
      }`}
    >
      {/* Conflict banner */}
      {conflict_flag && (
        <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2">
          <svg className="h-5 w-5 text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <span className="text-sm text-red-700 font-medium">{conflict_reason}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 truncate">
            {deal?.customer_name || '-'}
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">{vehicle}</p>
        </div>
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium shrink-0 ${
            STATUS_COLORS[status] || 'bg-gray-100 text-gray-800'
          }`}
        >
          {t(`dispatch.status.${status}`)}
        </span>
      </div>

      {/* Details */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        <div>
          <span className="text-gray-500">{t('dispatch.stockNumber')}</span>
          <p className="font-mono text-gray-900">{deal?.stock_number || '-'}</p>
        </div>
        <div>
          <span className="text-gray-500">{t('dispatch.deliveryDate')}</span>
          <p className="text-gray-900">{deal?.tentative_delivery_date || '-'}</p>
        </div>
      </div>

      {/* Trade-in badge */}
      <div>
        {has_trade_in ? (
          <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-800 px-2.5 py-0.5 text-xs font-medium">
            {t('dispatch.withTradeIn')}
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-gray-100 text-gray-600 px-2.5 py-0.5 text-xs font-medium">
            {t('dispatch.withoutTradeIn')}
          </span>
        )}
      </div>

      {/* Assigned resources */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        <div>
          <span className="text-gray-500">{t('dispatch.chaserVehicle')}</span>
          <p className="text-gray-900">{chaser?.name || t('dispatch.unassigned')}</p>
        </div>
        <div>
          <span className="text-gray-500">{t('dispatch.dealerPlate')}</span>
          <p className="text-gray-900">{plate?.plate_number || t('dispatch.unassigned')}</p>
        </div>
        <div>
          <span className="text-gray-500">{t('dispatch.driversNeeded')}</span>
          <p className="text-gray-900">{num_drivers_needed ?? '-'}</p>
        </div>
        <div>
          <span className="text-gray-500">{t('dispatch.company')}</span>
          <p className="text-gray-900">
            {dispatch_company ? t(`dispatch.companies.${dispatch_company}`) : '-'}
          </p>
        </div>
      </div>

      {/* Mark Complete */}
      {status !== 'completed' && (
        <button
          type="button"
          onClick={onComplete}
          className="w-full rounded-md bg-green-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-colors"
        >
          {t('dispatch.markComplete')}
        </button>
      )}
    </div>
  );
}
