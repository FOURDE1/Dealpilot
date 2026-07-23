import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp, ChevronDown, ChevronUp, ShieldCheck, Star, Trash2, Upload,
  Send, FileDown, Mail, ArrowLeft, Printer, Save } from 'lucide-react';
import { formatCurrency, formatPercent } from '../../utils/deskingCalculations';

function Dotted({ dot, children }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dot}`} />
      <div className="flex-1">{children}</div>
    </div>
  );
}

function SummaryLine({ label, value, strong, color, prefix }) {
  return (
    <div className="flex items-center justify-between text-sm py-1">
      <span className="text-gray-600 flex items-center gap-1">
        {prefix && <span className="text-gray-400 w-3 text-center">{prefix}</span>}
        {label}
      </span>
      <span className={`${strong ? 'font-bold' : 'font-medium'} ${color || 'text-gray-900'} tabular-nums`}>{value}</span>
    </div>
  );
}

export default function PaymentSummary({
  state, computed, dealId,
  buyer = null, scenarios = [], onSaveScenario, onLoadScenario, onDeleteScenario, onToggleRecommend,
  onPrint, onSaveReturn, onSendFI, onConvertToDeal, isManager = true,
}) {
  const { t } = useTranslation();
  const [showProfit, setShowProfit] = useState(false);
  const { dealType, active, nativeStatus } = computed;
  const typeLabel = dealType === 'finance' ? t('desking.finance') : dealType === 'lease' ? t('desking.lease') : t('desking.cash');
  const totalGrossColor = computed.totalGross >= 0 ? 'text-emerald-700' : 'text-red-600';

  return (
    <div className="space-y-3 sticky top-4">
      {/* Payment hero */}
      <div className="relative bg-gradient-to-br from-teal-600 via-teal-500 to-emerald-500 text-white rounded-xl shadow-xl overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.18),transparent_60%)] pointer-events-none" />
        <div className="relative p-6">
          <div className="text-[11px] uppercase tracking-widest opacity-90 mb-2 font-semibold">{t('desking.paymentSummary')}</div>
          {dealType !== 'cash' ? (
            <>
              <div className="text-5xl font-extrabold leading-none mb-1 tabular-nums drop-shadow-sm">{formatCurrency(active?.monthly || 0)}</div>
              <div className="text-xs opacity-90">/ {t('desking.perMonth')}</div>
              <div className="grid grid-cols-2 gap-2 mt-4 text-xs">
                <div className="bg-white/15 backdrop-blur-sm rounded-xl p-2.5 ring-1 ring-white/10">
                  <div className="opacity-80 uppercase tracking-wide text-[10px]">{t('desking.biweekly')}</div>
                  <div className="font-bold tabular-nums text-sm">{formatCurrency(active?.biweekly || 0)}</div>
                </div>
                <div className="bg-white/15 backdrop-blur-sm rounded-xl p-2.5 ring-1 ring-white/10">
                  <div className="opacity-80 uppercase tracking-wide text-[10px]">{t('desking.weekly')}</div>
                  <div className="font-bold tabular-nums text-sm">{formatCurrency(active?.weekly || 0)}</div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="text-4xl font-extrabold leading-none mb-1 tabular-nums">{formatCurrency(computed.cashTotalDue)}</div>
              <div className="text-xs opacity-90">{t('desking.totalDue')}</div>
            </>
          )}

          <div className="flex flex-wrap gap-1.5 mt-4">
            <span className="px-2.5 py-0.5 text-[11px] bg-white/20 backdrop-blur-sm text-white/90 rounded-full font-semibold">{typeLabel}</span>
            {active?.term > 0 && <span className="px-2.5 py-0.5 text-[11px] bg-white/20 backdrop-blur-sm text-white/90 rounded-full tabular-nums">{active.term} mo</span>}
            {active?.rate > 0 && <span className="px-2.5 py-0.5 text-[11px] bg-white/20 backdrop-blur-sm text-white/90 rounded-full tabular-nums">{formatPercent(active.rate, 2)}</span>}
            <span className="px-2.5 py-0.5 text-[11px] bg-white/20 backdrop-blur-sm text-white/90 rounded-full">{state.provinceCode}</span>
            {nativeStatus && (
              <span className="px-2.5 py-0.5 text-[11px] bg-green-400/30 text-white border border-green-300/50 rounded-full flex items-center gap-1 font-bold">
                <ShieldCheck size={10} /> TAX EXEMPT
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Lender strip */}
      {state.selectedLender && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 px-4 py-2 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-gray-500 font-semibold">{t('desking.financingThrough')}</span>
          <span className="text-sm font-bold text-gray-900">{state.selectedLender.name}</span>
        </div>
      )}

      {/* Deal breakdown */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="h-4 w-1 rounded-full bg-gradient-to-b from-red-600 to-red-400" />
          <h3 className="text-xs uppercase tracking-widest text-gray-600 font-bold">{t('desking.dealBreakdown') || 'Deal Breakdown'}</h3>
        </div>
        <Dotted dot="bg-blue-500"><SummaryLine label={t('desking.salePrice')} value={formatCurrency(computed.salePrice)} /></Dotted>
        <Dotted dot="bg-orange-500"><SummaryLine label={t('desking.tradeEquity')} value={`(${formatCurrency(computed.totalTradeEquity)})`} color="text-red-700" prefix="−" /></Dotted>
        <Dotted dot="bg-green-500"><SummaryLine label={t('desking.cashDown')} value={`(${formatCurrency(state.cashDown || 0)})`} color="text-red-700" prefix="−" /></Dotted>
        <Dotted dot="bg-purple-500"><SummaryLine label={t('desking.rebates')} value={`(${formatCurrency(computed.rebatesTotal)})`} color="text-red-700" prefix="−" /></Dotted>
        <Dotted dot="bg-amber-500"><SummaryLine label={t('desking.feesTotal')} value={formatCurrency(computed.feesTotal)} prefix="+" /></Dotted>
        <Dotted dot="bg-indigo-500"><SummaryLine label={t('desking.fiProducts')} value={formatCurrency(computed.fiRevenue)} prefix="+" /></Dotted>
        <Dotted dot="bg-red-500"><SummaryLine label={t('desking.taxTotal')} value={formatCurrency(computed.taxes.total)} prefix="+" /></Dotted>
        <div className="border-t-2 border-gray-200 mt-2 pt-2">
          <SummaryLine label={dealType === 'lease' ? t('desking.adjustedCapCost') : t('desking.amountFinanced')} value={formatCurrency(active?.financed || 0)} strong />
          {dealType === 'finance' && <SummaryLine label={t('desking.costOfBorrowing')} value={formatCurrency(computed.costOfBorrowing)} color="text-gray-500" />}
          <SummaryLine label={t('desking.totalObligation') || 'Total Obligation'} value={formatCurrency(active?.totalCost || 0)} strong color="text-red-600" />
        </div>
      </div>

      {/* Profitability */}
      {isManager && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <button
            type="button"
            onClick={() => setShowProfit((v) => !v)}
            className="w-full flex items-center justify-between text-xs uppercase tracking-wide font-semibold text-gray-700 hover:text-gray-900"
          >
            <span className="flex items-center gap-1"><TrendingUp size={12} /> {t('desking.profitability')}</span>
            {showProfit ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {showProfit && (
            <div className="mt-2">
              <SummaryLine label={t('desking.frontGross')} value={formatCurrency(computed.frontGross)} />
              <SummaryLine label={t('desking.tradeSpread')} value={formatCurrency(computed.totalTradeSpread)} />
              <SummaryLine label={t('desking.fiGross')} value={formatCurrency(computed.fiGross)} />
              <div className="border-t border-gray-200 mt-1 pt-1">
                <SummaryLine label={t('desking.totalGross')} value={formatCurrency(computed.totalGross)} strong color={totalGrossColor} />
                <SummaryLine label={t('desking.grossPct')} value={formatPercent(computed.grossPct, 1)} color={totalGrossColor} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Scenarios */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs uppercase tracking-wide text-gray-500 font-semibold">{t('desking.scenarios')}</h3>
          <button onClick={onSaveScenario} className="inline-flex items-center gap-1 text-[11px] text-teal-700 hover:text-teal-900 font-semibold">
            <Save size={11} /> {t('desking.saveCurrent') || 'Save Current'}
          </button>
        </div>
        {scenarios.length === 0 ? (
          <p className="text-xs text-gray-400 italic">{t('desking.noScenarios')}</p>
        ) : (
          <div className="space-y-2">
            {scenarios.map((s) => {
              const c = s.snapshot || {};
              return (
                <div key={s.id} className={`rounded-lg border p-2 ${s.recommended ? 'border-amber-400 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      <button onClick={() => onToggleRecommend(s.id)} className={s.recommended ? 'text-amber-500' : 'text-gray-300 hover:text-amber-400'}>
                        <Star size={12} fill={s.recommended ? 'currentColor' : 'none'} />
                      </button>
                      <span className="text-xs font-semibold text-gray-800 truncate">{s.name}</span>
                    </div>
                    <span className="text-[9px] px-1.5 py-0.5 bg-teal-100 text-teal-700 rounded uppercase font-bold">{c.dealType}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-gray-600">
                    <span className="font-semibold tabular-nums text-gray-900">{formatCurrency(c.monthly || 0)}/{c.dealType === 'cash' ? '—' : 'mo'}</span>
                    <span className="tabular-nums">{c.term ? `${c.term}mo` : ''} {c.rate ? formatPercent(c.rate) : ''}</span>
                  </div>
                  <div className="mt-1 flex gap-1">
                    <button onClick={() => onLoadScenario(s)} className="flex-1 inline-flex items-center justify-center gap-1 py-1 text-[10px] bg-teal-600 hover:bg-teal-700 text-white rounded font-semibold">
                      <Upload size={10} /> {t('desking.load')}
                    </button>
                    <button onClick={() => onDeleteScenario(s.id)} className="p-1 bg-red-100 text-red-600 hover:bg-red-200 rounded">
                      <Trash2 size={10} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 space-y-3">
        {onConvertToDeal && (
          <button
            onClick={onConvertToDeal}
            disabled={!buyer}
            title={!buyer ? 'Attach a client to continue' : ''}
            className="w-full inline-flex items-center justify-center gap-2 py-2.5 text-sm font-semibold bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-lg shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
          >
            <ArrowLeft size={14} className="rotate-180" /> Convert to Deal
          </button>
        )}
        <button onClick={onSendFI} className="w-full inline-flex items-center justify-center gap-2 py-2.5 text-sm font-semibold bg-gradient-to-r from-red-700 to-red-600 hover:from-red-800 hover:to-red-700 text-white rounded-lg shadow-lg hover:shadow-xl transition-all">
          <Send size={14} /> {t('desking.sendToFi')}
        </button>
        <button onClick={onPrint} className="w-full inline-flex items-center justify-center gap-2 py-2.5 text-sm font-semibold bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white rounded-lg shadow-md hover:shadow-lg transition-all">
          <FileDown size={14} /> {t('desking.generatePdf')}
        </button>
        {dealId && (
          <button onClick={onSaveReturn} className="w-full inline-flex items-center justify-center gap-2 py-2.5 text-sm font-semibold bg-gradient-to-r from-teal-600 to-emerald-500 hover:from-teal-700 hover:to-emerald-600 text-white rounded-lg shadow-md hover:shadow-lg transition-all">
            <ArrowLeft size={14} /> {t('desking.saveReturn')}
          </button>
        )}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button onClick={onPrint} className="inline-flex items-center justify-center gap-1 py-2 text-xs border border-gray-300 hover:bg-gray-50 text-gray-600 rounded-lg transition-all">
            <Printer size={12} /> {t('desking.printDealSheet')}
          </button>
          <button
            disabled={!buyer?.email}
            onClick={() => {
              const name = `${buyer.first_name} ${buyer.last_name}`.trim();
              const v = state.vehicle || {};
              const title = `${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim();
              const subject = encodeURIComponent(`Payment Quote — ${title} — ${name}`);
              window.location.href = `mailto:${buyer.email}?subject=${subject}`;
            }}
            className={`inline-flex items-center justify-center gap-1 py-2 text-xs rounded-lg transition-all ${
              buyer?.email
                ? 'border border-gray-300 hover:bg-gray-50 text-gray-600'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          >
            <Mail size={12} /> {t('desking.emailQuote')}
          </button>
        </div>
      </div>
    </div>
  );
}
