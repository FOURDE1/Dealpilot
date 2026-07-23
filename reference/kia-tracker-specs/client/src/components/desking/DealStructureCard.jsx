import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import WorksheetLine from './WorksheetLine';
import { formatPercent } from '../../utils/deskingCalculations';

const FINANCE_TERMS = [24, 36, 48, 60, 72, 84, 96];
const LEASE_TERMS = [24, 36, 39, 48, 60];

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative px-5 py-2.5 text-sm transition-all ${
        active
          ? 'text-red-600 font-bold'
          : 'text-gray-500 hover:text-gray-800 font-medium'
      }`}
    >
      {children}
      {active && <span className="absolute left-2 right-2 -bottom-[2px] h-[3px] bg-gradient-to-r from-red-600 to-red-500 rounded-full" />}
    </button>
  );
}

function TermPills({ terms, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {terms.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={`min-w-[52px] px-3 py-1.5 text-xs font-bold rounded-lg border-2 transition-all tabular-nums ${
            value === m
              ? 'bg-gradient-to-r from-red-600 to-red-500 text-white border-red-600 shadow-lg scale-105 transform'
              : 'bg-white text-gray-600 border-gray-200 hover:border-red-300 hover:bg-red-50'
          }`}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

function ExemptTag() {
  return (
    <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded">EXEMPT</span>
  );
}

export default function DealStructureCard({ state, computed, setField, onOpenRebates, onOpenLenderManage }) {
  const { t } = useTranslation();
  const dealType = state.dealType;
  const taxLines = computed.taxes.breakdown || [];
  const isExempt = computed.nativeStatus;

  return (
    <section className="bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 pt-2 border-b border-gray-200 bg-gradient-to-b from-gray-50 to-white">
        <TabButton active={dealType === 'finance'} onClick={() => setField('dealType', 'finance')}>{t('desking.finance')}</TabButton>
        <TabButton active={dealType === 'lease'} onClick={() => setField('dealType', 'lease')}>{t('desking.lease')}</TabButton>
        <TabButton active={dealType === 'cash'} onClick={() => setField('dealType', 'cash')}>{t('desking.cash')}</TabButton>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={dealType}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
          className="p-6 space-y-1.5 tabular-nums"
        >
          {/* ============ FINANCE ============ */}
          {dealType === 'finance' && (
            <>
              <WorksheetLine label={t('desking.salePrice')} amount={state.salePrice} editable onChange={(x) => setField('salePrice', x)} />
              <WorksheetLine label={t('desking.tradeEquity')} amount={computed.totalTradeEquity} credit prefix="−" />
              <WorksheetLine label={t('desking.cashDown')} amount={state.cashDown} editable onChange={(x) => setField('cashDown', x)} credit={state.cashDown > 0} prefix="−" />
              <WorksheetLine label={t('desking.rebates')} amount={computed.rebatesTotal} credit prefix="−" onClick={onOpenRebates} />
              <WorksheetLine label={t('desking.subtotal')} amount={Math.max(0, state.salePrice - computed.totalTradeEquity - state.cashDown - computed.rebatesTotal)} subtotal strong prefix="=" />

              {taxLines.map((b) => (
                <WorksheetLine key={b.label} label={b.label} amount={b.amount} tag={isExempt ? <ExemptTag /> : null} indent={1} />
              ))}
              {isExempt && taxLines.length === 0 && (
                <WorksheetLine label={t('desking.taxTotal')} amount={0} tag={<ExemptTag />} indent={1} />
              )}
              <WorksheetLine label={t('desking.feesTotal')} amount={computed.feesTotal} />
              <WorksheetLine label={t('desking.fiProducts')} amount={computed.fiRevenue} />
              <WorksheetLine label={t('desking.amountFinanced')} amount={computed.amountFinanced} total prefix="=" />

              {/* Rate + term controls */}
              <div className="grid grid-cols-2 gap-4 pt-4 pb-2">
                <div>
                  <label className="text-[10px] uppercase text-gray-500 block mb-1">{t('desking.interestRate')}</label>
                  <div className="flex items-center gap-2">
                    <div className="relative w-36">
                      <input
                        type="number" step="0.01" min="0" max="30"
                        value={state.interestRate}
                        onChange={(e) => setField('interestRate', parseFloat(e.target.value) || 0)}
                        className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm text-right tabular-nums pr-12"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">% APR</span>
                    </div>
                    {state.selectedLender && (
                      <button
                        onClick={onOpenLenderManage}
                        className="text-xs text-teal-700 hover:text-teal-900 underline"
                        title={state.selectedLender.name}
                      >
                        via {state.selectedLender.shortName || state.selectedLender.name}
                      </button>
                    )}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] uppercase text-gray-500 block mb-1">{t('desking.term')}</label>
                  <TermPills terms={FINANCE_TERMS} value={state.term} onChange={(x) => setField('term', x)} />
                </div>
              </div>

              <WorksheetLine label={t('desking.monthlyPayment')} amount={computed.financeMonthly} strong className="bg-teal-50 -mx-6 px-6 py-2" />
              <WorksheetLine label={t('desking.biweekly')} amount={computed.financeBiweekly} indent={1} />
              <WorksheetLine label={t('desking.weekly')} amount={computed.financeWeekly} indent={1} />
              <WorksheetLine label={t('desking.costOfBorrowing')} amount={computed.costOfBorrowing} subtotal />
              <WorksheetLine label={t('desking.totalObligation') || 'Total Obligation'} amount={computed.amountFinanced + computed.costOfBorrowing} total prefix="=" />
            </>
          )}

          {/* ============ LEASE ============ */}
          {dealType === 'lease' && (
            <>
              <WorksheetLine label={`${t('desking.capCost')} (${t('desking.salePrice')})`} amount={state.salePrice} editable onChange={(x) => setField('salePrice', x)} />
              <WorksheetLine label={t('desking.capReductions')} amount={computed.capReductions} credit prefix="−" />
              <WorksheetLine label={t('desking.adjustedCapCost')} amount={computed.adjustedCapCost} subtotal strong prefix="=" />

              <div className="grid grid-cols-2 gap-4 pt-3 pb-1">
                <div>
                  <label className="text-[10px] uppercase text-gray-500 block mb-1">{t('desking.residualPct')}</label>
                  <div className="relative w-28">
                    <input
                      type="number" step="0.5" min="0" max="99"
                      value={state.residualPercent}
                      onChange={(e) => setField('residualPercent', parseFloat(e.target.value) || 0)}
                      className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm text-right tabular-nums pr-7"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">%</span>
                  </div>
                </div>
                <div>
                  <label className="text-[10px] uppercase text-gray-500 block mb-1">{t('desking.residualDollar')}</label>
                  <div className="text-sm font-bold pt-1.5">{computed.residualDollar.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' })}</div>
                </div>
                <div>
                  <label className="text-[10px] uppercase text-gray-500 block mb-1">{t('desking.moneyFactor')}</label>
                  <input
                    type="number" step="0.00001" min="0" max="1"
                    value={state.moneyFactor}
                    onChange={(e) => setField('moneyFactor', parseFloat(e.target.value) || 0)}
                    className="w-28 px-3 py-1.5 border border-gray-300 rounded text-sm text-right tabular-nums"
                  />
                  <span className="ml-2 text-xs text-gray-500">= {formatPercent(computed.equivalentApr)} APR</span>
                </div>
                <div>
                  <label className="text-[10px] uppercase text-gray-500 block mb-1">{t('desking.term')}</label>
                  <TermPills terms={LEASE_TERMS} value={state.leaseTerm} onChange={(x) => setField('leaseTerm', x)} />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-gray-500 block mb-1">{t('desking.kmPerYear')}</label>
                  <input
                    type="number" step="1000"
                    value={state.kmPerYear}
                    onChange={(e) => setField('kmPerYear', parseFloat(e.target.value) || 0)}
                    className="w-32 px-3 py-1.5 border border-gray-300 rounded text-sm text-right tabular-nums"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-gray-500 block mb-1">{t('desking.excessKm')}</label>
                  <div className="relative w-28">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                    <input
                      type="number" step="0.01"
                      value={state.excessKmCharge}
                      onChange={(e) => setField('excessKmCharge', parseFloat(e.target.value) || 0)}
                      className="w-full pl-5 pr-2 py-1.5 border border-gray-300 rounded text-sm text-right tabular-nums"
                    />
                  </div>
                </div>
              </div>

              <WorksheetLine label={t('desking.baseMonthly')} amount={computed.leaseBase} />
              <WorksheetLine label={t('desking.taxOnPayment')} amount={computed.leaseTaxOnPayment} tag={isExempt ? <ExemptTag /> : null} />
              <WorksheetLine label={t('desking.totalMonthly')} amount={computed.leaseMonthly} total prefix="=" className="bg-teal-50 -mx-6 px-6 py-2" />
              <WorksheetLine label={t('desking.biweekly')} amount={computed.leaseBiweekly} indent={1} />
              <WorksheetLine label={t('desking.weekly')} amount={computed.leaseWeekly} indent={1} />
              <WorksheetLine label={t('desking.totalLeaseCost')} amount={computed.leaseTotalCost} subtotal />
            </>
          )}

          {/* ============ CASH ============ */}
          {dealType === 'cash' && (
            <>
              <WorksheetLine label={t('desking.salePrice')} amount={state.salePrice} editable onChange={(x) => setField('salePrice', x)} />
              <WorksheetLine label={t('desking.tradeEquity')} amount={computed.totalTradeEquity} credit prefix="−" />
              <WorksheetLine label={t('desking.rebates')} amount={computed.rebatesTotal} credit prefix="−" onClick={onOpenRebates} />
              <WorksheetLine label={t('desking.subtotal')} amount={computed.cashSubtotal} subtotal strong prefix="=" />

              {taxLines.map((b) => (
                <WorksheetLine key={b.label} label={b.label} amount={b.amount} tag={isExempt ? <ExemptTag /> : null} indent={1} />
              ))}
              {isExempt && taxLines.length === 0 && (
                <WorksheetLine label={t('desking.taxTotal')} amount={0} tag={<ExemptTag />} indent={1} />
              )}
              <WorksheetLine label={t('desking.feesTotal')} amount={computed.feesTotal} />
              <WorksheetLine label={t('desking.fiProducts')} amount={computed.fiRevenue} />
              <WorksheetLine label={t('desking.totalDue')} amount={computed.cashTotalDue} total prefix="=" className="bg-teal-50 -mx-6 px-6 py-2" />

              <div className="pt-3">
                <label className="text-[10px] uppercase text-gray-500 block mb-1">{t('desking.deposit')}</label>
                <div className="relative w-48">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                  <input
                    type="number" step="0.01" min="0"
                    value={state.cashDown}
                    onChange={(e) => setField('cashDown', parseFloat(e.target.value) || 0)}
                    className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg text-sm text-right tabular-nums"
                  />
                </div>
              </div>
              <WorksheetLine label={t('desking.balanceOwing')} amount={Math.max(0, computed.cashTotalDue - (state.cashDown || 0))} total prefix="=" />
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </section>
  );
}
