import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { X, CheckSquare, RefreshCw, Trash2, Download, Calendar, Tag as TagIcon } from 'lucide-react';
import TagPicker from './TagPicker';

const API_URL = import.meta.env.VITE_API_URL;

const STATUS_OPTIONS = [
  { value: 'new', labelKey: 'leads.status.new' },
  { value: 'assigned', labelKey: 'leads.status.assigned' },
  { value: 'contacted', labelKey: 'leads.status.contacted' },
  { value: 'qualified', labelKey: 'leads.status.qualified' },
  { value: 'unresponsive', labelKey: 'leads.status.unresponsive' },
  { value: 'nurture', labelKey: 'leads.status.nurture' },
  { value: 'lost', labelKey: 'leads.status.lost' },
];

export default function BulkActionBar({ selectedIds, leads, onClearSelection, onBulkScheduleFollowUp, onBulkTagsApplied }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [appliedTagIds, setAppliedTagIds] = useState([]);
  const count = selectedIds.length;

  const handleBulkTagClick = async (tag) => {
    if (appliedTagIds.includes(tag.id)) return;
    setLoading(true);
    try {
      await Promise.all(
        selectedIds.map(leadId =>
          fetch(`${API_URL}/leads/${leadId}/tags`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tag_id: tag.id }),
          }).then(r => {
            if (!r.ok) throw new Error('Bulk tag failed');
            return r.json();
          })
        )
      );
      setAppliedTagIds(prev => [...prev, tag.id]);
      queryClient.invalidateQueries({ queryKey: ['lead-tags-map'] });
      onBulkTagsApplied?.();
    } catch (err) {
      console.error('Bulk tag error:', err);
      alert(t('bulk.errorTags'));
    } finally {
      setLoading(false);
    }
  };

  const closeBulkTagPicker = () => {
    setShowTagPicker(false);
    setAppliedTagIds([]);
  };

  const handleBulkStatusChange = async (newStatus) => {
    setLoading(true);
    setShowStatusDropdown(false);
    try {
      const res = await fetch(`${API_URL}/leads/bulk`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_ids: selectedIds, updates: { status: newStatus } }),
      });
      if (!res.ok) throw new Error('Bulk update failed');
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['all-follow-up-tasks'] });
      onClearSelection();
    } catch (err) {
      console.error('Bulk status change error:', err);
      alert(t('bulk.errorStatus'));
    } finally {
      setLoading(false);
    }
  };

  const handleBulkDelete = async () => {
    const confirmed = window.confirm(t('bulk.confirmDelete', { count }));
    if (!confirmed) return;

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/leads/bulk`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_ids: selectedIds }),
      });
      if (!res.ok) throw new Error('Bulk delete failed');
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['all-follow-up-tasks'] });
      onClearSelection();
    } catch (err) {
      console.error('Bulk delete error:', err);
      alert(t('bulk.errorDelete'));
    } finally {
      setLoading(false);
    }
  };

  const handleExportCSV = () => {
    const selectedLeads = (leads || []).filter(l => selectedIds.includes(l.id));
    const headers = ['First Name', 'Last Name', 'Email', 'Phone', 'Status', 'Source', 'Vehicle Interest', 'Score', 'Created At'];
    const rows = selectedLeads.map(l => [
      l.first_name || '',
      l.last_name || '',
      l.email || '',
      l.phone || '',
      l.status || '',
      l.source || '',
      l.vehicle_interest || '',
      l.score || '',
      l.created_at ? new Date(l.created_at).toLocaleDateString() : '',
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `leads-export-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (count === 0) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-gray-900 text-white px-5 py-3 rounded-xl shadow-2xl border border-gray-700">
      <div className="flex items-center gap-2 pr-3 border-r border-gray-600">
        <CheckSquare size={18} className="text-blue-400" />
        <span className="font-semibold text-sm">
          {t('bulk.selected', { count })}
        </span>
      </div>

      <div className="relative">
        <button
          onClick={() => setShowStatusDropdown(prev => !prev)}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} />
          {t('bulk.changeStatus')}
        </button>
        {showStatusDropdown && (
          <div className="absolute bottom-full mb-2 left-0 bg-white text-gray-900 rounded-lg shadow-xl border border-gray-200 py-1 min-w-[160px]">
            {STATUS_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => handleBulkStatusChange(opt.value)}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 transition-colors"
              >
                {t(opt.labelKey)}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={() => onBulkScheduleFollowUp?.(selectedIds)}
        disabled={loading}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50"
      >
        <Calendar size={14} />
        {t('bulk.scheduleFollowUp')}
      </button>

      <div className="relative">
        <button
          onClick={() => setShowTagPicker(prev => !prev)}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50"
        >
          <TagIcon size={14} />
          {t('bulk.addTags')}
        </button>
        {showTagPicker && (
          <div className="absolute bottom-full mb-2 left-0">
            <TagPicker
              selectedTagIds={appliedTagIds}
              onToggleTag={handleBulkTagClick}
              onClose={closeBulkTagPicker}
              title={t('bulk.applyTagsTitle', { count })}
            />
          </div>
        )}
      </div>

      <button
        onClick={handleExportCSV}
        disabled={loading}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50"
      >
        <Download size={14} />
        {t('bulk.exportCSV')}
      </button>

      <button
        onClick={handleBulkDelete}
        disabled={loading}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg hover:bg-red-600 text-red-300 hover:text-white transition-colors disabled:opacity-50"
      >
        <Trash2 size={14} />
        {t('bulk.delete')}
      </button>

      <button
        onClick={onClearSelection}
        className="ml-1 p-1.5 rounded-lg hover:bg-gray-700 transition-colors"
        title={t('bulk.clearSelection')}
      >
        <X size={16} />
      </button>
    </div>
  );
}
