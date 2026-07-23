import { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, AlertTriangle, Check } from 'lucide-react';
import SlideOutPanel from './SlideOutPanel';
import { PARSED_FIELD_GROUPS, FIELD_LABELS } from '../../utils/dealertrackPdfParser';
import { findLenderByName } from '../../utils/lenderData';
import { formatCurrency } from '../../utils/deskingCalculations';

const MONEY_FIELDS = new Set([
  'msrp', 'sellingPrice', 'tradeAllowance', 'tradePayoff', 'tradeACV',
  'cashDown', 'rebate', 'amountFinanced', 'monthlyPayment', 'biWeeklyPayment',
  'gstHstAmount', 'pst', 'adminFee', 'licenseFee', 'ppsaFee', 'installationDeliveryFee',
  'costOfBorrowing', 'totalObligation',
  'extendedWarranty', 'gapProtection', 'replacementWarranty', 'lifeInsurance',
  'ahInsurance', 'criticalIllness', 'appearanceProtection', 'tireAndRim', 'antiTheft',
]);

function formatValue(field, value) {
  if (value == null) return '—';
  if (MONEY_FIELDS.has(field)) return formatCurrency(value);
  if (field === 'interestRate') return `${value}%`;
  if (field === 'term') return `${value} mo`;
  return String(value);
}

// Compare parsed value to existing state for conflict highlighting.
function getCurrentValueFor(field, state) {
  const v = state?.vehicle || {};
  const trade = (Array.isArray(state?.trades) && state.trades[0]) || {};
  switch (field) {
    case 'year': return v.year;
    case 'make': return v.make;
    case 'model': return v.model;
    case 'vin': return v.vin;
    case 'stockNumber': return v.stock;
    case 'mileage': return v.mileage;
    case 'msrp': return state?.msrp;
    case 'sellingPrice': return state?.salePrice;
    case 'province': return state?.provinceCode;
    case 'tradeYear': return trade.year;
    case 'tradeMake': return trade.make;
    case 'tradeModel': return trade.model;
    case 'tradeMileage': return trade.mileage;
    case 'tradeAllowance': return trade.allowance;
    case 'tradePayoff': return trade.lien;
    case 'tradeACV': return trade.acv;
    case 'interestRate': return state?.interestRate;
    case 'term': return state?.term;
    case 'cashDown': return state?.cashDown;
    case 'lenderName': return state?.selectedLender?.name;
    default: return null;
  }
}

function hasConflict(field, parsedValue, state) {
  const cur = getCurrentValueFor(field, state);
  if (cur == null || cur === '' || cur === 0) return false;
  return String(cur).toLowerCase().trim() !== String(parsedValue).toLowerCase().trim();
}

export default function PdfImportConfirmation({ open, onClose, result, state, onImport }) {
  const { t } = useTranslation();
  const parsed = result?.data || {};
  const warnings = result?.warnings || [];

  const matchedLender = useMemo(() => {
    if (!parsed.lenderName) return null;
    return findLenderByName(parsed.lenderName);
  }, [parsed.lenderName]);

  const allFields = Object.keys(parsed);
  const [selected, setSelected] = useState(() => Object.fromEntries(allFields.map((k) => [k, true])));

  useEffect(() => {
    if (open) {
      setSelected(Object.fromEntries(Object.keys(parsed).map((k) => [k, true])));
    }
  }, [open, result]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (k) => setSelected((s) => ({ ...s, [k]: !s[k] }));

  const doImport = () => {
    const payload = {};
    for (const k of Object.keys(parsed)) {
      if (selected[k]) payload[k] = parsed[k];
    }
    onImport(payload, selected.lenderName ? matchedLender : null);
    onClose();
  };

  return (
    <SlideOutPanel
      open={open}
      onClose={onClose}
      title={t('desking.pdfImport')}
      icon={FileText}
      width={560}
      footer={
        <button onClick={doImport} className="px-4 py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg inline-flex items-center gap-1.5">
          <Check size={14} /> {t('desking.importSelected')}
        </button>
      }
    >
      {result?.success ? (
        <>
          <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded text-sm text-emerald-800">
            {t('desking.pdfParseSuccess', { count: result.matchedCount || allFields.length })}
          </div>

          {warnings.length > 0 && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800 space-y-1">
              {warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          {Object.entries(PARSED_FIELD_GROUPS).map(([groupKey, fields]) => {
            const presentFields = fields.filter((f) => parsed[f] != null);
            if (presentFields.length === 0) return null;
            return (
              <div key={groupKey} className="mb-4">
                <h3 className="text-xs font-bold uppercase text-gray-500 mb-2">{t(`desking.${groupKey}`)}</h3>
                <div className="space-y-1.5">
                  {presentFields.map((f) => {
                    const value = parsed[f];
                    const conflict = hasConflict(f, value, state);
                    const currentVal = getCurrentValueFor(f, state);
                    return (
                      <label
                        key={f}
                        className={`flex items-center gap-2 p-2 border rounded cursor-pointer ${
                          conflict ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white hover:bg-gray-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={!!selected[f]}
                          onChange={() => toggle(f)}
                          className="h-4 w-4"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900">{FIELD_LABELS[f] || f}</div>
                          {conflict && (
                            <div className="text-[11px] text-amber-700 flex items-center gap-2">
                              <span>{t('desking.currentValue')}: <span className="font-semibold tabular-nums">{formatValue(f, currentVal)}</span></span>
                              <span className="text-amber-500">→</span>
                              <span>{t('desking.newValue')}: <span className="font-semibold tabular-nums">{formatValue(f, value)}</span></span>
                            </div>
                          )}
                          {f === 'lenderName' && (
                            <div className="text-[11px] text-gray-500">
                              {matchedLender
                                ? `Matched → ${matchedLender.name}`
                                : 'No match found in lender list — will not auto-select.'}
                            </div>
                          )}
                        </div>
                        {!conflict && (
                          <span className="text-sm font-semibold tabular-nums text-gray-900">{formatValue(f, value)}</span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </>
      ) : (
        <div className="p-4 bg-red-50 border border-red-200 rounded text-sm text-red-800">
          <div className="font-semibold mb-1">{t('desking.pdfParseFail')}</div>
          {result?.error && <div className="text-xs mt-1">{result.error}</div>}
        </div>
      )}
    </SlideOutPanel>
  );
}
