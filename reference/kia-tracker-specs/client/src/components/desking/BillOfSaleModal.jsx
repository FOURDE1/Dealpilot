import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Printer, FileDown, Mail, ChevronDown } from 'lucide-react';

export default function BillOfSaleModal({ onPrint, onSavePdf, onEmail }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const choose = (fn) => { setOpen(false); fn?.(); };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 text-white rounded-lg shadow-sm hover:shadow-md transition-all"
      >
        <FileText size={12} /> {t('desking.billOfSale')} <ChevronDown size={10} />
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-xl z-50 overflow-hidden">
          <button
            onClick={() => choose(onPrint)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-800 hover:bg-emerald-50 text-left"
          >
            <Printer size={14} className="text-emerald-700" />
            <span>{t('desking.printBillOfSale')}</span>
          </button>
          <button
            onClick={() => choose(onSavePdf)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-800 hover:bg-emerald-50 text-left border-t border-gray-100"
          >
            <FileDown size={14} className="text-emerald-700" />
            <span>{t('desking.savePdf')}</span>
          </button>
          <button
            onClick={() => choose(onEmail)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-800 hover:bg-emerald-50 text-left border-t border-gray-100"
          >
            <Mail size={14} className="text-emerald-700" />
            <span>{t('desking.emailBillOfSale')}</span>
          </button>
        </div>
      )}
    </div>
  );
}
