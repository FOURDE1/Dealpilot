import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Check, X, Tag as TagIcon } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL;

const PRESET_COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444',
  '#8B5CF6', '#EC4899', '#06B6D4', '#64748B',
];

export default function TagPicker({
  selectedTagIds = [],
  onToggleTag,
  onClose,
  title,
  applyLabel,
  onApply,
  showApplyButton = false,
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const containerRef = useRef(null);

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [createError, setCreateError] = useState('');

  const { data: tags = [], isLoading } = useQuery({
    queryKey: ['tags'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/tags`);
      if (!res.ok) return [];
      const json = await res.json();
      return json.data || [];
    },
  });

  const createTag = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_URL}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), color: newColor }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Failed to create tag');
      }
      return res.json();
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      setNewName('');
      setShowCreate(false);
      setCreateError('');
      if (created?.id) onToggleTag?.(created);
    },
    onError: (err) => setCreateError(err.message),
  });

  useEffect(() => {
    const onClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        onClose?.();
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={containerRef}
      className="absolute z-50 w-72 bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
          <TagIcon size={14} />
          {title || t('tags.picker.title')}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600"
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>

      <div className="max-h-56 overflow-y-auto py-1">
        {isLoading ? (
          <div className="px-3 py-4 text-xs text-gray-400 text-center">…</div>
        ) : tags.length === 0 ? (
          <div className="px-3 py-4 text-xs text-gray-400 text-center">{t('tags.picker.empty')}</div>
        ) : (
          tags.map(tag => {
            const selected = selectedTagIds.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => onToggleTag?.(tag)}
                className="w-full flex items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-gray-50"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: tag.color }}
                  />
                  <span className="truncate">{tag.name}</span>
                </span>
                {selected && <Check size={14} className="text-blue-600 flex-shrink-0" />}
              </button>
            );
          })
        )}
      </div>

      <div className="border-t border-gray-100">
        {showCreate ? (
          <div className="p-3 space-y-2">
            <input
              type="text"
              value={newName}
              autoFocus
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('tags.picker.namePlaceholder')}
              maxLength={50}
              className="w-full text-sm px-2 py-1.5 rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newName.trim()) {
                  e.preventDefault();
                  createTag.mutate();
                }
              }}
            />
            <div className="flex items-center gap-1">
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setNewColor(c)}
                  className={`w-5 h-5 rounded-full ${newColor === c ? 'ring-2 ring-offset-1 ring-gray-700' : ''}`}
                  style={{ backgroundColor: c }}
                  aria-label={`Color ${c}`}
                />
              ))}
            </div>
            {createError && <div className="text-[11px] text-red-600">{createError}</div>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setShowCreate(false); setNewName(''); setCreateError(''); }}
                className="flex-1 px-2 py-1 text-xs rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50"
              >
                {t('tags.picker.cancel')}
              </button>
              <button
                type="button"
                onClick={() => createTag.mutate()}
                disabled={!newName.trim() || createTag.isPending}
                className="flex-1 px-2 py-1 text-xs rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {createTag.isPending ? '…' : t('tags.picker.create')}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50"
          >
            <Plus size={14} />
            {t('tags.picker.createNew')}
          </button>
        )}
      </div>

      {showApplyButton && (
        <div className="border-t border-gray-100 p-2">
          <button
            type="button"
            onClick={onApply}
            className="w-full px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700"
          >
            {applyLabel || t('tags.picker.apply')}
          </button>
        </div>
      )}
    </div>
  );
}
