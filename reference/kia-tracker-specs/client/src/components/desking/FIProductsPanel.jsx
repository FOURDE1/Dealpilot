import { useState } from 'react';
import { Shield, Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import SlideOutPanel from './SlideOutPanel';
import { Toggle } from './SectionCard';
import { formatCurrency } from '../../utils/deskingCalculations';

function ProductRow({ p, onUpdate, onRemove }) {
  const [showDetail, setShowDetail] = useState(false);
  const profit = (Number(p?.price) || 0) - (Number(p?.cost) || 0);
  return (
    <div className="border-b border-gray-100 last:border-b-0 py-2">
      <div className="flex items-center gap-2">
        <Toggle checked={!!p.enabled} onChange={(v) => onUpdate({ enabled: v })} />
        {p.custom ? (
          <input value={p.label} onChange={(e) => onUpdate({ label: e.target.value })} className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded" />
        ) : (
          <button onClick={() => setShowDetail((s) => !s)} className="flex-1 text-left text-sm text-gray-700 truncate hover:text-gray-900 flex items-center gap-1">
            {showDetail ? <ChevronDown size={10} /> : <ChevronRight size={10} />} {p.label}
          </button>
        )}
        <div className="relative w-24">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
          <input
            type="number" step="0.01"
            value={p.price}
            onChange={(e) => onUpdate({ price: parseFloat(e.target.value) || 0 })}
            className="w-full pl-5 pr-1 py-1 text-xs text-right border border-gray-300 rounded tabular-nums"
            placeholder="Price"
          />
        </div>
        <span className={`text-xs w-16 text-right tabular-nums font-semibold ${profit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
          {formatCurrency(profit)}
        </span>
        {p.custom && (
          <button onClick={onRemove} className="text-red-500 hover:text-red-700"><Trash2 size={12} /></button>
        )}
      </div>
      {showDetail && (
        <div className="mt-2 ml-8 pl-2 border-l-2 border-gray-200 flex items-center gap-3 text-xs">
          <label className="flex items-center gap-1 text-gray-600">
            Cost:
            <div className="relative w-20">
              <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-gray-400">$</span>
              <input
                type="number" step="0.01"
                value={p.cost}
                onChange={(e) => onUpdate({ cost: parseFloat(e.target.value) || 0 })}
                className="w-full pl-4 pr-1 py-0.5 border border-gray-300 rounded"
              />
            </div>
          </label>
          <label className="flex items-center gap-1 text-gray-600">
            <input type="checkbox" checked={p.taxable !== false} onChange={(e) => onUpdate({ taxable: e.target.checked })} />
            Taxable
          </label>
        </div>
      )}
    </div>
  );
}

function CategorySection({ category, products, updateProduct, removeProduct, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  const enabledCount = products.filter((p) => p.enabled).length;
  const categoryTotal = products.filter((p) => p.enabled).reduce((a, p) => a + (Number(p.price) || 0), 0);

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-gray-800">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {category}
          {enabledCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 bg-teal-600 text-white rounded-full font-bold">{enabledCount}</span>
          )}
        </span>
        <span className="text-xs font-semibold text-gray-600 tabular-nums">
          {categoryTotal > 0 ? formatCurrency(categoryTotal) : ''}
        </span>
      </button>
      {open && (
        <div className="px-3 py-1">
          {products.map((p) => (
            <ProductRow key={p.id} p={p} onUpdate={(patch) => updateProduct(p.id, patch)} onRemove={() => removeProduct(p.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function FIProductsPanel({ open, onClose, state, computed, updateProduct, addProduct, removeProduct }) {
  const { t } = useTranslation();
  const products = Array.isArray(state?.fiProducts) ? state.fiProducts : [];
  const categories = Array.from(new Set(products.map((p) => p.category)));
  const enabledCategory = (cat) => products.some((p) => p.category === cat && p.enabled);

  return (
    <SlideOutPanel
      open={open}
      onClose={onClose}
      title={t('desking.fiProducts')}
      icon={Shield}
      width={560}
      footer={
        <button onClick={addProduct} className="inline-flex items-center gap-1 px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg">
          <Plus size={14} /> {t('desking.addProduct')}
        </button>
      }
    >
      <div className="space-y-2">
        {categories.map((cat) => (
          <CategorySection
            key={cat}
            category={cat}
            products={products.filter((p) => p.category === cat)}
            updateProduct={updateProduct}
            removeProduct={removeProduct}
            defaultOpen={enabledCategory(cat)}
          />
        ))}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center sticky bottom-0">
        <div className="bg-gray-50 rounded p-2 border border-gray-200">
          <div className="text-[10px] uppercase text-gray-500">{t('desking.fiRevenue')}</div>
          <div className="text-sm font-bold text-gray-900 tabular-nums">{formatCurrency(computed.fiRevenue)}</div>
        </div>
        <div className="bg-gray-50 rounded p-2 border border-gray-200">
          <div className="text-[10px] uppercase text-gray-500">{t('desking.fiCost')}</div>
          <div className="text-sm font-bold text-gray-900 tabular-nums">{formatCurrency(computed.fiCost)}</div>
        </div>
        <div className="bg-emerald-50 rounded p-2 border border-emerald-200">
          <div className="text-[10px] uppercase text-emerald-700">{t('desking.fiGross')}</div>
          <div className="text-sm font-bold text-emerald-700 tabular-nums">{formatCurrency(computed.fiGross)}</div>
        </div>
      </div>
    </SlideOutPanel>
  );
}
