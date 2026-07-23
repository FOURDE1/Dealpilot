import { useTranslation } from 'react-i18next';
import { ShieldCheck, RotateCcw, Printer, Upload } from 'lucide-react';
import { PROVINCES, PROVINCE_CODES } from '../../utils/canadianTaxRates';
import LenderSelector from './LenderSelector';
import BillOfSaleModal from './BillOfSaleModal';

export default function DeskingTopBar({
  deals = [], state, computed,
  onSelectDeal, onSetField, onReset, onPrint,
  onOpenPdf, onSelectLender, onOpenManageLenders,
  onPrintBillOfSale, onSavePdfBillOfSale, onEmailBillOfSale,
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('fr') ? 'fr' : 'en';
  const selectedDeal = deals.find((d) => d.id === state.dealId);

  return (
    <div className="bg-white/80 backdrop-blur-md border-b border-gray-200 shadow-sm px-4 py-2 flex flex-wrap items-center gap-2 print:hidden sticky top-0 z-20">
      <select
        value={state.dealId || ''}
        onChange={(e) => onSelectDeal(e.target.value || null)}
        className="flex-1 min-w-[200px] max-w-sm px-3 py-1.5 border border-gray-300 rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500 transition-all"
      >
        <option value="">— {t('desking.newDesk')} —</option>
        {deals.map((d) => (
          <option key={d.id} value={d.id}>
            #{d.deal_number} — {d.customer_name} · {d.vehicle_year} {d.vehicle_make} {d.vehicle_model}
          </option>
        ))}
      </select>

      {selectedDeal && (
        <span className="px-2 py-0.5 text-xs font-semibold bg-teal-100 text-teal-800 rounded-full whitespace-nowrap">
          Deal #{selectedDeal.deal_number}
        </span>
      )}

      <div className="flex items-center gap-2 ml-auto flex-wrap">
        <select
          value={state.provinceCode}
          onChange={(e) => onSetField('provinceCode', e.target.value)}
          className="px-3 py-1.5 border border-gray-300 border-l-4 border-l-blue-500 rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 transition-all"
          title={t('desking.province')}
        >
          {PROVINCE_CODES.map((code) => (
            <option key={code} value={code}>
              {code} — {lang === 'fr' ? PROVINCES[code].nameFr : PROVINCES[code].name}
            </option>
          ))}
        </select>

        <LenderSelector
          selected={state.selectedLender}
          onSelect={onSelectLender}
          onManage={onOpenManageLenders}
          compact
        />

        <label className={`flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded-lg bg-white text-xs cursor-pointer select-none whitespace-nowrap transition-all ${state.nativeStatus ? 'ring-2 ring-green-400/50 border-green-400' : ''}`}>
          <input
            type="checkbox"
            checked={!!state.nativeStatus}
            onChange={(e) => onSetField('nativeStatus', e.target.checked)}
            className="h-3.5 w-3.5"
          />
          <ShieldCheck size={12} className="text-emerald-600" />
          <span>{t('desking.nativeStatus')}</span>
        </label>

        {computed.nativeStatus && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold bg-emerald-100 text-emerald-800 rounded-full whitespace-nowrap animate-pulse">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> TAX EXEMPT
          </span>
        )}

        <div className="h-5 w-px bg-gray-300 mx-1" />

        <button onClick={onOpenPdf} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-700 hover:to-indigo-600 text-white rounded-lg shadow-sm hover:shadow-md transition-all" title={t('desking.pdfImport')}>
          <Upload size={12} /> {t('desking.pdfImport')}
        </button>
        <button onClick={onReset} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg transition-all">
          <RotateCcw size={12} /> {t('desking.newDesk')}
        </button>
        <button onClick={onPrint} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs bg-gray-800 hover:bg-gray-900 text-white rounded-lg shadow-sm hover:shadow-md transition-all">
          <Printer size={12} /> {t('desking.printProposal')}
        </button>
        <BillOfSaleModal
          onPrint={onPrintBillOfSale}
          onSavePdf={onSavePdfBillOfSale}
          onEmail={onEmailBillOfSale}
        />
      </div>
    </div>
  );
}
