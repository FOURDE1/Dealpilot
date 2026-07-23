import { useTranslation } from 'react-i18next';
import { Receipt, Plus, Trash2, Package } from 'lucide-react';
import SectionCard, { Toggle } from './SectionCard';
import { formatCurrency } from '../../utils/deskingCalculations';

function FeeRow({ fee, onUpdate, onRemove }) {
  return (
    <tr className="border-b border-gray-100 last:border-b-0 text-sm">
      <td className="py-2 pr-2">
        <Toggle checked={!!fee.enabled} onChange={(v) => onUpdate({ enabled: v })} />
      </td>
      <td className="py-2 pr-2">
        {fee.custom ? (
          <input value={fee.label} onChange={(e) => onUpdate({ label: e.target.value })} className="w-full px-2 py-1 text-xs border border-gray-300 rounded" />
        ) : (
          <span className="text-gray-700">{fee.label}</span>
        )}
      </td>
      <td className="py-2 pr-2">
        <div className="relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
          <input type="number" step="0.01" value={fee.amount}
            onChange={(e) => onUpdate({ amount: parseFloat(e.target.value) || 0 })}
            className="w-24 pl-5 pr-2 py-1 text-xs border border-gray-300 rounded" />
        </div>
      </td>
      <td className="py-2 pr-2">
        <label className="inline-flex items-center gap-1 text-xs text-gray-500">
          <input type="checkbox" checked={!!fee.taxable} onChange={(e) => onUpdate({ taxable: e.target.checked })} />
          Tax
        </label>
      </td>
      <td className="py-2 pr-2 text-right">
        {fee.custom && <button onClick={onRemove} className="text-red-500 hover:text-red-700"><Trash2 size={12} /></button>}
      </td>
    </tr>
  );
}

export function FeesCard({ state, computed, updateFee, addFee, removeFee }) {
  const { t } = useTranslation();
  const fees = Array.isArray(state?.fees) ? state.fees : [];
  return (
    <SectionCard
      title={t('desking.feesCharges')}
      icon={Receipt}
      right={
        <button onClick={addFee} className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-white/20 hover:bg-white/30 rounded">
          <Plus size={12} /> {t('desking.addFee')}
        </button>
      }
    >
      <table className="w-full">
        <thead>
          <tr className="text-xs text-gray-500 uppercase border-b border-gray-200">
            <th className="py-1 pr-2 text-left w-12">On</th>
            <th className="py-1 pr-2 text-left">{t('desking.fee')}</th>
            <th className="py-1 pr-2 text-left">{t('desking.amount')}</th>
            <th className="py-1 pr-2 text-left">Tax</th>
            <th className="py-1 pr-2"></th>
          </tr>
        </thead>
        <tbody>
          {fees.map((f) => (
            <FeeRow key={f.id} fee={f} onUpdate={(patch) => updateFee(f.id, patch)} onRemove={() => removeFee(f.id)} />
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex justify-end text-sm font-semibold">
        <span className="text-gray-600 mr-4">{t('desking.feesTotal')}:</span>
        <span className="text-teal-700">{formatCurrency(computed.feesTotal)}</span>
      </div>
    </SectionCard>
  );
}

function ProductRow({ p, onUpdate, onRemove }) {
  const profit = (Number(p.price) || 0) - (Number(p.cost) || 0);
  return (
    <tr className="border-b border-gray-100 last:border-b-0 text-sm">
      <td className="py-2 pr-2"><Toggle checked={!!p.enabled} onChange={(v) => onUpdate({ enabled: v })} /></td>
      <td className="py-2 pr-2">
        {p.custom ? (
          <input value={p.label} onChange={(e) => onUpdate({ label: e.target.value })} className="w-full px-2 py-1 text-xs border border-gray-300 rounded" />
        ) : (
          <span className="text-gray-700">{p.label}</span>
        )}
      </td>
      <td className="py-2 pr-2">
        <div className="relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
          <input type="number" step="0.01" value={p.cost}
            onChange={(e) => onUpdate({ cost: parseFloat(e.target.value) || 0 })}
            className="w-24 pl-5 pr-2 py-1 text-xs border border-gray-300 rounded" />
        </div>
      </td>
      <td className="py-2 pr-2">
        <div className="relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
          <input type="number" step="0.01" value={p.price}
            onChange={(e) => onUpdate({ price: parseFloat(e.target.value) || 0 })}
            className="w-24 pl-5 pr-2 py-1 text-xs border border-gray-300 rounded" />
        </div>
      </td>
      <td className={`py-2 pr-2 text-xs font-semibold ${profit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
        {formatCurrency(profit)}
      </td>
      <td className="py-2 pr-2">
        <label className="inline-flex items-center gap-1 text-xs text-gray-500">
          <input type="checkbox" checked={p.taxable !== false} onChange={(e) => onUpdate({ taxable: e.target.checked })} />
          Tax
        </label>
      </td>
      <td className="py-2 pr-2 text-right">
        {p.custom && <button onClick={onRemove} className="text-red-500 hover:text-red-700"><Trash2 size={12} /></button>}
      </td>
    </tr>
  );
}

export function FIProductsCard({ state, computed, updateProduct, addProduct, removeProduct }) {
  const { t } = useTranslation();
  const products = Array.isArray(state?.fiProducts) ? state.fiProducts : [];
  const categories = Array.from(new Set(products.map((p) => p.category)));
  return (
    <SectionCard
      title={t('desking.fiProducts')}
      icon={Package}
      right={
        <button onClick={addProduct} className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-white/20 hover:bg-white/30 rounded">
          <Plus size={12} /> {t('desking.addProduct')}
        </button>
      }
    >
      <div className="space-y-4 max-h-[600px] overflow-y-auto">
        {categories.map((cat) => (
          <div key={cat}>
            <h4 className="text-xs font-bold text-gray-500 uppercase mb-1 sticky top-0 bg-white py-1">{cat}</h4>
            <table className="w-full">
              <thead>
                <tr className="text-[10px] text-gray-400 uppercase border-b border-gray-200">
                  <th className="py-1 pr-2 text-left w-12">On</th>
                  <th className="py-1 pr-2 text-left">{t('desking.product')}</th>
                  <th className="py-1 pr-2 text-left">{t('desking.dealerCost')}</th>
                  <th className="py-1 pr-2 text-left">{t('desking.sellingPrice')}</th>
                  <th className="py-1 pr-2 text-left">{t('desking.profit')}</th>
                  <th className="py-1 pr-2 text-left">Tax</th>
                  <th className="py-1 pr-2"></th>
                </tr>
              </thead>
              <tbody>
                {products.filter((p) => p.category === cat).map((p) => (
                  <ProductRow key={p.id} p={p} onUpdate={(patch) => updateProduct(p.id, patch)} onRemove={() => removeProduct(p.id)} />
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      <div className="mt-4 pt-3 border-t border-gray-200 grid grid-cols-3 gap-3 text-center">
        <div className="bg-gray-50 rounded p-2">
          <div className="text-[10px] uppercase text-gray-500">{t('desking.fiRevenue')}</div>
          <div className="text-sm font-bold text-gray-900">{formatCurrency(computed.fiRevenue)}</div>
        </div>
        <div className="bg-gray-50 rounded p-2">
          <div className="text-[10px] uppercase text-gray-500">{t('desking.fiCost')}</div>
          <div className="text-sm font-bold text-gray-900">{formatCurrency(computed.fiCost)}</div>
        </div>
        <div className="bg-emerald-50 rounded p-2">
          <div className="text-[10px] uppercase text-emerald-700">{t('desking.fiGross')}</div>
          <div className="text-sm font-bold text-emerald-700">{formatCurrency(computed.fiGross)}</div>
        </div>
      </div>
    </SectionCard>
  );
}
