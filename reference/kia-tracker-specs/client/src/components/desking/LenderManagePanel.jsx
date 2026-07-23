import { useState, useEffect } from 'react';
import { Landmark, Trash2, EyeOff, Eye, Save, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import SlideOutPanel from './SlideOutPanel';
import {
  DEFAULT_LENDERS, loadCustomLenders, saveCustomLenders,
  loadHiddenLenderIds, saveHiddenLenderIds, CATEGORY_ORDER, CATEGORY_LABEL_KEY,
} from '../../utils/lenderData';

function EditableRow({ lender, isCustom, hidden, onUpdate, onDelete, onToggleHide }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(lender);
  useEffect(() => setDraft(lender), [lender]);

  const save = () => { onUpdate(draft); setEditing(false); };

  if (editing && isCustom) {
    return (
      <div className="p-2 border border-teal-300 bg-teal-50 rounded space-y-2">
        <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t('desking.lenderName')} className="w-full px-2 py-1 text-sm border border-gray-300 rounded" />
        <div className="flex gap-2">
          <input value={draft.shortName || ''} onChange={(e) => setDraft({ ...draft, shortName: e.target.value })} placeholder={t('desking.lenderShortName')} className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded" />
          <input type="number" step="0.01" value={draft.defaultRate ?? ''} onChange={(e) => setDraft({ ...draft, defaultRate: e.target.value === '' ? null : parseFloat(e.target.value) })} placeholder={t('desking.lenderDefaultRate')} className="w-28 px-2 py-1 text-xs border border-gray-300 rounded" />
        </div>
        <input value={draft.notes || ''} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder={t('desking.lenderNotes')} className="w-full px-2 py-1 text-xs border border-gray-300 rounded" />
        <div className="flex items-center gap-2 justify-end">
          <button onClick={() => setEditing(false)} className="px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 rounded"><X size={12} /></button>
          <button onClick={save} className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-teal-600 text-white rounded"><Save size={12} /> Save</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 p-2 border border-gray-200 rounded ${hidden ? 'opacity-50 bg-gray-50' : 'bg-white'}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-gray-900 truncate">{lender.name}</span>
          <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded font-bold">{lender.shortName}</span>
          {lender.defaultRate != null && (
            <span className="text-[10px] px-1.5 py-0.5 bg-teal-100 text-teal-700 rounded font-semibold tabular-nums">{lender.defaultRate}%</span>
          )}
        </div>
        {lender.notes && <div className="text-[11px] text-gray-500 truncate">{lender.notes}</div>}
      </div>
      {isCustom ? (
        <>
          <button onClick={() => setEditing(true)} className="px-2 py-1 text-[11px] text-teal-700 hover:bg-teal-50 rounded">Edit</button>
          <button onClick={() => onDelete(lender.id)} className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded" title={t('desking.deleteLender')}>
            <Trash2 size={14} />
          </button>
        </>
      ) : (
        <button onClick={() => onToggleHide(lender.id)} className="p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded" title={t('desking.hideLender')}>
          {hidden ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
      )}
    </div>
  );
}

export default function LenderManagePanel({ open, onClose }) {
  const { t } = useTranslation();
  const [custom, setCustom] = useState(() => loadCustomLenders());
  const [hidden, setHidden] = useState(() => loadHiddenLenderIds());

  const all = [...DEFAULT_LENDERS, ...custom];
  const groups = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: all.filter((l) => l.category === cat),
  })).filter((g) => g.items.length > 0);

  const updateCustom = (updated) => {
    const next = custom.map((l) => (l.id === updated.id ? updated : l));
    setCustom(next); saveCustomLenders(next);
  };
  const deleteCustom = (id) => {
    const next = custom.filter((l) => l.id !== id);
    setCustom(next); saveCustomLenders(next);
  };
  const toggleHide = (id) => {
    const next = hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id];
    setHidden(next); saveHiddenLenderIds(next);
  };

  return (
    <SlideOutPanel open={open} onClose={onClose} title={t('desking.manageLenders')} icon={Landmark} width={540}>
      <div className="space-y-4">
        {groups.map(({ cat, items }) => (
          <div key={cat}>
            <div className="text-[10px] font-bold uppercase text-gray-500 mb-1.5 tracking-wide">
              {t(CATEGORY_LABEL_KEY[cat])}
            </div>
            <div className="space-y-1.5">
              {items.map((l) => (
                <EditableRow
                  key={l.id}
                  lender={l}
                  isCustom={l.category === 'CUSTOM'}
                  hidden={hidden.includes(l.id)}
                  onUpdate={updateCustom}
                  onDelete={deleteCustom}
                  onToggleHide={toggleHide}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </SlideOutPanel>
  );
}
