import { Repeat, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import SlideOutPanel from './SlideOutPanel';
import { Field, MoneyInput, NumberInput, TextInput } from './SectionCard';
import { formatCurrency } from '../../utils/deskingCalculations';

function TradeBlock({ index, trade, onChange, onRemove, canRemove }) {
  const { t } = useTranslation();
  const equity = (Number(trade?.allowance) || 0) - (Number(trade?.lien) || 0);
  const spread = (Number(trade?.allowance) || 0) - (Number(trade?.acv) || 0);
  const spreadColor = spread <= 0 ? 'text-emerald-700 bg-emerald-50' : 'text-red-700 bg-red-50';

  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-gray-700 uppercase">{t('desking.trade')} #{index + 1}</h3>
        {canRemove && <button onClick={onRemove} className="text-red-500 hover:text-red-700"><Trash2 size={14} /></button>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('desking.year')}><TextInput value={trade?.year} onChange={(x) => onChange({ year: x })} /></Field>
        <Field label={t('desking.make')}><TextInput value={trade?.make} onChange={(x) => onChange({ make: x })} /></Field>
        <Field label={t('desking.model')} className="col-span-2"><TextInput value={trade?.model} onChange={(x) => onChange({ model: x })} /></Field>
        <Field label={t('desking.mileage')}><NumberInput value={trade?.mileage} onChange={(x) => onChange({ mileage: x })} suffix="km" /></Field>
        <Field label="VIN"><TextInput value={trade?.vin} onChange={(x) => onChange({ vin: x })} /></Field>
        <Field label={t('desking.tradeAcv')}><MoneyInput value={trade?.acv} onChange={(x) => onChange({ acv: x })} /></Field>
        <Field label={t('desking.tradeAllowance')}><MoneyInput value={trade?.allowance} onChange={(x) => onChange({ allowance: x })} /></Field>
        <Field label={t('desking.tradeLien')} className="col-span-2"><MoneyInput value={trade?.lien} onChange={(x) => onChange({ lien: x })} /></Field>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="text-xs bg-white px-3 py-2 rounded border">
          <div className="text-gray-500">{t('desking.netEquity')}</div>
          <div className={`font-bold ${equity >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{formatCurrency(equity)}</div>
        </div>
        <div className={`text-xs px-3 py-2 rounded border ${spreadColor}`}>
          <div className="opacity-70">{spread <= 0 ? t('desking.underAcv') : t('desking.overAcv')}</div>
          <div className="font-bold">{formatCurrency(Math.abs(spread))}</div>
        </div>
      </div>
    </div>
  );
}

export default function TradeInPanel({ open, onClose, state, setTrade, addTrade, removeTrade }) {
  const { t } = useTranslation();
  const trades = Array.isArray(state?.trades) ? state.trades : [];

  return (
    <SlideOutPanel
      open={open}
      onClose={onClose}
      title={t('desking.tradeIn')}
      icon={Repeat}
      footer={trades.length < 2 ? (
        <button onClick={addTrade} className="inline-flex items-center gap-1 px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg">
          <Plus size={14} /> {t('desking.add2ndTrade')}
        </button>
      ) : null}
    >
      <div className="space-y-3">
        {trades.map((trade, i) => (
          <TradeBlock
            key={i}
            index={i}
            trade={trade}
            onChange={(patch) => setTrade(i, patch)}
            onRemove={() => removeTrade(i)}
            canRemove={trades.length > 1}
          />
        ))}
      </div>
    </SlideOutPanel>
  );
}
