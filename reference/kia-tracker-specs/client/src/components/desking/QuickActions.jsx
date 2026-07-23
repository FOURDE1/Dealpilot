import { useTranslation } from 'react-i18next';
import { Send, FileDown, Mail, ArrowLeft, Printer } from 'lucide-react';

export default function QuickActions({ dealId, onSendFI, onPrint, onSaveReturn }) {
  const { t } = useTranslation();
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 space-y-3 print:hidden">
      <h3 className="text-xs uppercase tracking-widest font-bold text-gray-600 mb-1">{t('desking.quickActions')}</h3>
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
        <button disabled className="inline-flex items-center justify-center gap-1 py-2 text-xs bg-gray-100 text-gray-400 rounded-lg cursor-not-allowed">
          <Mail size={12} /> {t('desking.emailQuote')}
        </button>
      </div>
    </div>
  );
}
