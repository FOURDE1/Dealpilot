import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Plus, Building2, X, Pencil } from 'lucide-react';
import EditSupplierModal from './EditSupplierModal';

const API_URL = import.meta.env.VITE_API_URL;

export default function SupplierSelector({ value, onChange, expenseCategories = [], authToken }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState({ name: '', category: '', phone: '', email: '' });
  const ref = useRef(null);

  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers', 'active'],
    queryFn: async () => {
      const r = await fetch(`${API_URL}/suppliers?active=true`);
      if (!r.ok) return [];
      return r.json();
    },
  });

  const filtered = q
    ? suppliers.filter((s) => s.name.toLowerCase().includes(q.toLowerCase()))
    : suppliers;

  const submit = async () => {
    if (!draft.name.trim()) return;
    const r = await fetch(`${API_URL}/suppliers`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    if (!r.ok) return;
    const created = await r.json();
    qc.invalidateQueries({ queryKey: ['suppliers'] });
    onChange(created);
    setAdding(false);
    setDraft({ name: '', category: '', phone: '', email: '' });
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <div className="relative flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex-1 inline-flex items-center justify-between gap-1.5 px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm hover:border-amber-400 transition-colors"
        >
          <span className="flex items-center gap-1.5 min-w-0">
            <Building2 size={14} className="text-gray-400 shrink-0" />
            <span className={`truncate ${value ? 'text-gray-900' : 'text-gray-400'}`}>
              {value?.name || 'Select supplier…'}
            </span>
          </span>
          <ChevronDown size={14} className="text-gray-400 shrink-0" />
        </button>

        {value && (
          <button
            type="button"
            title="Edit supplier"
            onClick={(e) => { e.stopPropagation(); setEditingSupplier(value); setOpen(false); }}
            className="p-2 rounded-lg border border-gray-300 hover:border-amber-400 hover:bg-amber-50 text-gray-600"
          >
            <Pencil size={14} />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl z-40 max-h-80 overflow-y-auto">
          <div className="p-2 border-b border-gray-200">
            <input
              autoFocus value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search suppliers…"
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-amber-500/30"
            />
          </div>
          {value && (
            <button onClick={() => { onChange(null); setOpen(false); }}
              className="w-full px-3 py-2 text-xs text-red-600 hover:bg-red-50 text-left border-b border-gray-100">
              Clear selection
            </button>
          )}
          {filtered.length === 0 && !adding && (
            <div className="px-3 py-3 text-xs text-gray-400 italic">No suppliers match "{q}"</div>
          )}
          {filtered.map((s) => (
            <button
              key={s.id}
              onClick={() => { onChange(s); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-amber-50 flex items-center justify-between"
            >
              <span className="truncate">{s.name}</span>
              {s.category && <span className="ml-2 text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">{s.category}</span>}
            </button>
          ))}

          {adding ? (
            <div className="p-3 bg-gray-50 border-t border-gray-200 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-700">New supplier</span>
                <button onClick={() => setAdding(false)} className="text-gray-400 hover:text-gray-700"><X size={14} /></button>
              </div>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Name *" className="w-full px-2 py-1 text-xs border border-gray-300 rounded" />
              <input value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} placeholder="Category (mechanical, detail, …)" className="w-full px-2 py-1 text-xs border border-gray-300 rounded" />
              <div className="flex gap-2">
                <input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} placeholder="Phone" className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded" />
                <input value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} placeholder="Email" className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded" />
              </div>
              <button onClick={submit} className="w-full py-1.5 text-xs bg-amber-600 hover:bg-amber-700 text-white rounded font-semibold">
                Create supplier
              </button>
              <button
                type="button"
                onClick={() => { setEditingSupplier('new'); setAdding(false); setOpen(false); }}
                className="text-xs text-blue-600 hover:underline mt-1"
              >
                More details…
              </button>
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="w-full text-left px-3 py-2 text-xs text-amber-700 hover:bg-amber-50 border-t border-gray-200 font-semibold flex items-center gap-1"
            >
              <Plus size={12} /> Add new supplier
            </button>
          )}
        </div>
      )}

      {editingSupplier && (
        <EditSupplierModal
          supplier={editingSupplier === 'new' ? null : editingSupplier}
          expenseCategories={expenseCategories}
          onClose={() => setEditingSupplier(null)}
          onSaved={(s) => {
            qc.invalidateQueries({ queryKey: ['suppliers'] });
            onChange(s);
            setEditingSupplier(null);
          }}
          authToken={authToken}
        />
      )}
    </div>
  );
}
