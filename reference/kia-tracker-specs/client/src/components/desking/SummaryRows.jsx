import { ChevronRight, Car, Receipt, Shield, Gift } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '../../utils/deskingCalculations';

function Row({ icon: Icon, iconColor, borderColor, title, summary, count, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative w-full flex items-center gap-3 py-3 px-4 bg-white hover:shadow-md border border-gray-100 rounded-xl text-left transition-all duration-200 hover:translate-x-1 border-l-4 ${borderColor}`}
    >
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${iconColor} shrink-0`}>
        <Icon size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          {title}
          {count > 0 && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold bg-red-500 text-white rounded-full">
              {count}
            </span>
          )}
        </div>
        <div className="text-xs text-gray-500 truncate">{summary}</div>
      </div>
      <ChevronRight size={16} className="text-gray-400 shrink-0 group-hover:text-gray-700 transition-colors" />
    </button>
  );
}

export default function SummaryRows({ state, computed, onOpen }) {
  const { t } = useTranslation();
  const trades = Array.isArray(state?.trades) ? state.trades : [];
  const rebates = Array.isArray(state?.rebates) ? state.rebates : [];
  const fees = Array.isArray(state?.fees) ? state.fees : [];
  const products = Array.isArray(state?.fiProducts) ? state.fiProducts : [];

  const firstTrade = trades[0] || {};
  const hasTrade = trades.some((t) => t?.allowance > 0 || t?.acv > 0 || t?.year);
  const tradeSummary = hasTrade
    ? `${firstTrade.year || ''} ${firstTrade.make || ''} ${firstTrade.model || ''} · ${formatCurrency(computed.totalTradeEquity)} equity`.trim()
    : t('desking.noneClickAdd') || 'None — click to add';
  const tradeCount = trades.filter((tr) => tr?.allowance > 0 || tr?.acv > 0 || tr?.year).length;

  const feesCount = fees.filter((f) => f?.enabled && f?.amount > 0).length;
  const feesSummary = feesCount > 0
    ? `${formatCurrency(computed.feesTotal)} · ${feesCount} ${t('desking.items') || 'items'}`
    : t('desking.noneClickAdd') || 'None — click to add';

  const productsCount = products.filter((p) => p?.enabled && p?.price > 0).length;
  const productsSummary = productsCount > 0
    ? `${formatCurrency(computed.fiRevenue)} · ${productsCount} ${t('desking.products') || 'products'}`
    : t('desking.noneClickAdd') || 'None — click to add';

  const rebatesCount = rebates.filter((r) => r?.enabled !== false && r?.amount > 0).length;
  const rebatesSummary = rebatesCount > 0
    ? `${formatCurrency(computed.rebatesTotal)} · ${rebatesCount} ${t('desking.items') || 'items'}`
    : t('desking.noneClickAdd') || 'None — click to add';

  return (
    <div className="space-y-2">
      <Row
        icon={Car} iconColor="bg-blue-50 text-blue-600" borderColor="border-l-blue-500"
        title={t('desking.tradeIn')} summary={tradeSummary} count={tradeCount}
        onClick={() => onOpen('trade')}
      />
      <Row
        icon={Receipt} iconColor="bg-amber-50 text-amber-600" borderColor="border-l-amber-500"
        title={t('desking.feesCharges')} summary={feesSummary} count={feesCount}
        onClick={() => onOpen('fees')}
      />
      <Row
        icon={Shield} iconColor="bg-purple-50 text-purple-600" borderColor="border-l-purple-500"
        title={t('desking.fiProducts')} summary={productsSummary} count={productsCount}
        onClick={() => onOpen('products')}
      />
      <Row
        icon={Gift} iconColor="bg-green-50 text-green-600" borderColor="border-l-green-500"
        title={t('desking.rebates')} summary={rebatesSummary} count={rebatesCount}
        onClick={() => onOpen('rebates')}
      />
    </div>
  );
}
