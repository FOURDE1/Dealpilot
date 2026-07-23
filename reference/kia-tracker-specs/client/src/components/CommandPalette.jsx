import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search, User, Car, X } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL;

export default function CommandPalette() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({ contacts: [], deals: [] });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  // Ctrl+K to open
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
    if (!open) {
      setQuery('');
      setResults({ contacts: [], deals: [] });
      setSelectedIndex(0);
    }
  }, [open]);

  // Debounced search
  const search = useCallback(async (q) => {
    if (q.length < 2) {
      setResults({ contacts: [], deals: [] });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = await res.json();
        setResults(data);
        setSelectedIndex(0);
      }
    } catch {
      // Silently fail — search is non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(query), 200);
    return () => clearTimeout(debounceRef.current);
  }, [query, search]);

  // Flatten results for keyboard navigation
  const allResults = [
    ...results.contacts.map((c) => ({
      type: 'contact',
      id: c.id,
      label: `${c.first_name} ${c.last_name}`,
      sub: c.phone || c.email || '',
      path: `/contacts/${c.id}`,
    })),
    ...results.deals.map((d) => ({
      type: 'deal',
      id: d.id,
      label: [d.stock_number && `#${d.stock_number}`, d.year, d.make, d.model].filter(Boolean).join(' '),
      sub: d.customer_name || d.deal_status,
      path: `/deal/${d.id}`,
    })),
  ];

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, allResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && allResults[selectedIndex]) {
      navigate(allResults[selectedIndex].path);
      setOpen(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />

      {/* Modal */}
      <div className="relative w-full max-w-lg bg-[var(--color-card)] rounded-xl shadow-2xl border border-[var(--color-border)] overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)]">
          <Search size={18} className="text-[var(--color-text-secondary)] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('search.placeholder')}
            className="flex-1 bg-transparent text-[var(--color-text)] outline-none text-sm"
          />
          <button onClick={() => setOpen(false)} className="text-[var(--color-text-secondary)] hover:text-[var(--color-text)]">
            <X size={16} />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto">
          {loading && (
            <div className="px-4 py-3 text-sm text-[var(--color-text-secondary)]">{t('search.searching')}</div>
          )}

          {!loading && query.length >= 2 && allResults.length === 0 && (
            <div className="px-4 py-6 text-sm text-center text-[var(--color-text-secondary)]">{t('search.noResults')}</div>
          )}

          {allResults.length > 0 && (
            <div className="py-1">
              {allResults.map((item, idx) => {
                const Icon = item.type === 'contact' ? User : Car;
                return (
                  <button
                    key={`${item.type}-${item.id}`}
                    onClick={() => { navigate(item.path); setOpen(false); }}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                      idx === selectedIndex ? 'bg-[var(--color-accent)]/10' : 'hover:bg-[var(--color-bg)]'
                    }`}
                  >
                    <Icon size={16} className="text-[var(--color-text-secondary)] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[var(--color-text)] truncate">{item.label}</div>
                      {item.sub && (
                        <div className="text-xs text-[var(--color-text-secondary)] truncate">{item.sub}</div>
                      )}
                    </div>
                    <span className="text-xs text-[var(--color-text-secondary)] capitalize">{item.type}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-[var(--color-border)] text-xs text-[var(--color-text-secondary)] flex gap-4">
          <span>↑↓ {t('search.navigate')}</span>
          <span>↵ {t('search.select')}</span>
          <span>esc {t('search.close')}</span>
        </div>
      </div>
    </div>
  );
}
