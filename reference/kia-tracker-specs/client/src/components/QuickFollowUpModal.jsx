import { useState, useEffect, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL;

function defaultDueAt() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  // datetime-local needs "YYYY-MM-DDTHH:mm" in local time
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function QuickFollowUpModal({ leadId, leadIds, leadName, isOpen, onClose, onSuccess }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const isBulk = Array.isArray(leadIds) && leadIds.length > 0;
  const bulkCount = isBulk ? leadIds.length : 0;

  const defaultTitle = useMemo(() => {
    if (isBulk) return `Follow up with ${bulkCount} selected leads`;
    return `Follow up with ${leadName || ''}`.trim();
  }, [isBulk, bulkCount, leadName]);

  const [title, setTitle] = useState(defaultTitle);
  const [dueAt, setDueAt] = useState(defaultDueAt);
  const [priority, setPriority] = useState('medium');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setTitle(defaultTitle);
      setDueAt(defaultDueAt());
      setPriority('medium');
      setNotes('');
      setError('');
    }
  }, [isOpen, defaultTitle]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const createTask = useMutation({
    mutationFn: async () => {
      const body = {
        title: title.trim() || defaultTitle,
        due_at: new Date(dueAt).toISOString(),
        priority,
        notes: notes.trim() || null,
        task_type: 'follow_up',
      };
      const targetIds = isBulk ? leadIds : [leadId];
      const results = await Promise.all(
        targetIds.map(async (id) => {
          const res = await fetch(`${API_URL}/leads/${id}/tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => null);
            throw new Error(data?.error || 'Failed to schedule follow-up');
          }
          return res.json();
        })
      );
      return results;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-follow-up-tasks'] });
      if (isBulk) {
        leadIds.forEach((id) => queryClient.invalidateQueries({ queryKey: ['lead-tasks', id] }));
      } else {
        queryClient.invalidateQueries({ queryKey: ['lead-tasks', leadId] });
      }
      onSuccess?.();
      onClose?.();
    },
    onError: (err) => setError(err.message),
  });

  if (!isOpen) return null;

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose?.();
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={handleBackdrop}
    >
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{t('followUp.modal.title')}</h2>
            {isBulk ? (
              <p className="text-sm text-gray-500 mt-0.5">{t('bulk.followUpFor', { count: bulkCount })}</p>
            ) : leadName ? (
              <p className="text-sm text-gray-500 mt-0.5">{leadName}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
            {error}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError('');
            createTask.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('followUp.modal.taskTitle')}
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('followUp.modal.dateTime')}
            </label>
            <input
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('followUp.modal.priority')}
            </label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="high">{t('followUp.priority.high')}</option>
              <option value="medium">{t('followUp.priority.medium')}</option>
              <option value="low">{t('followUp.priority.low')}</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('followUp.modal.notes')}
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder={t('followUp.modal.notesPlaceholder')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              {t('followUp.modal.cancel')}
            </button>
            <button
              type="submit"
              disabled={createTask.isPending || !dueAt}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {createTask.isPending ? t('followUp.modal.saving') : t('followUp.modal.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
