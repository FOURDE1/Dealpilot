import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Landmark, ChevronDown, Plus, Settings, X } from 'lucide-react';
import { getAllLenders, loadCustomLenders, saveCustomLenders, CATEGORY_ORDER, CATEGORY_LABEL_KEY } from '../../utils/lenderData';

function AddLenderForm({ onAdd, onCancel }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ name: '', shortName: '', category: 'PRIME', defaultRate: '', notes: '' });
  const submit = () => {
    if (!form.name.trim()) return;
    const lender = {
      id: `custom-${Date.now()}`,
      name: form.name.trim(),
      shortName: form.shortName.trim() || form.name.trim().slice(0, 6),
      category: 'CUSTOM',
      customCategory: form.category,
      defaultRate: form.defaultRate ? parseFloat(form.defaultRate) : null,
      notes: form.notes || '',
    };
    onAdd(lender);
  };
  return (
    <div className="p-3 bg-gray-50 border-t border-gray-200 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-700">{t('desking.addLender')}</span>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-700"><X size={14} /></button>
      </div>
      <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t('desking.lenderName')} className="w-full px-2 py-1 text-xs border border-gray-300 rounded" />
      <div className="flex gap-2">
        <input value={form.shortName} onChange={(e) => setForm({ ...form, shortName: e.target.value })} placeholder={t('desking.lenderShortName')} className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded" />
        <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="px-2 py-1 text-xs border border-gray-300 rounded">
          {CATEGORY_ORDER.filter((c) => c !== 'CUSTOM').map((c) => (
            <option key={c} value={c}>{t(CATEGORY_LABEL_KEY[c])}</option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <input value={form.defaultRate} onChange={(e) => setForm({ ...form, defaultRate: e.target.value })} placeholder={t('desking.lenderDefaultRate')} type="number" step="0.01" className="w-28 px-2 py-1 text-xs border border-gray-300 rounded" />
        <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder={t('desking.lenderNotes')} className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded" />
      </div>
      <button onClick={submit} className="w-full py-1.5 text-xs bg-teal-600 hover:bg-teal-700 text-white rounded font-semibold">
        {t('desking.addLender')}
      </button>
    </div>
  );
}

export default function LenderSelector({ selected, onSelect, onManage, compact = false }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [version, setVersion] = useState(0); // force re-read from localStorage
  const ref = useRef(null);

  useEffect(() => {
    const onClickOutside = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const lenders = getAllLenders();
  const grouped = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: lenders.filter((l) => l.category === cat),
  })).filter((g) => g.items.length > 0);

  const handleAdd = (lender) => {
    const current = loadCustomLenders();
    saveCustomLenders([...current, lender]);
    setAdding(false);
    setVersion((v) => v + 1);
    onSelect(lender);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative" key={version}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 border-l-4 border-l-amber-500 rounded-lg text-sm hover:border-amber-400 hover:shadow-sm transition-all ${compact ? 'text-xs' : ''}`}
        title={t('desking.selectLender')}
      >
        <Landmark size={compact ? 12 : 14} className="text-gray-500" />
        <span className={selected ? 'text-gray-900 font-medium' : 'text-gray-500'}>
          {selected?.shortName || selected?.name || t('desking.selectLender')}
        </span>
        <ChevronDown size={12} className="text-gray-400" />
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-80 bg-white border border-gray-200 rounded-lg shadow-xl z-50 max-h-[70vh] overflow-y-auto">
          <div className="p-2 border-b border-gray-200 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-gray-500">{t('desking.selectLender')}</span>
            <button onClick={() => { onManage(); setOpen(false); }} className="inline-flex items-center gap-1 text-[11px] text-teal-700 hover:text-teal-900">
              <Settings size={10} /> {t('desking.manageLenders')}
            </button>
          </div>
          {selected && (
            <button
              onClick={() => { onSelect(null); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-xs text-red-600 hover:bg-red-50 border-b border-gray-100"
            >
              Clear selection
            </button>
          )}
          {grouped.map(({ cat, items }) => (
            <div key={cat}>
              <div className="px-3 py-1 text-[10px] font-bold uppercase text-gray-400 bg-gray-50">
                {t(CATEGORY_LABEL_KEY[cat])}
              </div>
              {items.map((l) => (
                <button
                  key={l.id}
                  onClick={() => { onSelect(l); setOpen(false); }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-teal-50 flex items-center justify-between ${selected?.id === l.id ? 'bg-teal-100' : ''}`}
                >
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 truncate">{l.name}</div>
                    {l.notes && <div className="text-[10px] text-gray-500 truncate">{l.notes}</div>}
                  </div>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded ml-2">{l.shortName}</span>
                </button>
              ))}
            </div>
          ))}

          {adding ? (
            <AddLenderForm onAdd={handleAdd} onCancel={() => setAdding(false)} />
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="w-full text-left px-3 py-2 text-xs text-teal-700 hover:bg-teal-50 border-t border-gray-200 font-semibold flex items-center gap-1"
            >
              <Plus size={12} /> {t('desking.addLender')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
