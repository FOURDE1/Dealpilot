import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Clock, Edit2, Plus, Trash2, RotateCcw } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL;

const ACTION_ICONS = {
  created: Plus,
  updated: Edit2,
  deleted: Trash2,
  restored: RotateCcw,
};

function formatTimeAgo(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export default function Timeline({ entityType, entityId }) {
  const { t } = useTranslation();

  const { data, isLoading } = useQuery({
    queryKey: ['activity-events', entityType, entityId],
    queryFn: async () => {
      const res = await fetch(
        `${API_URL}/activity-events?entity_type=${entityType}&entity_id=${entityId}&limit=50`
      );
      if (!res.ok) throw new Error('Failed to fetch activity');
      return res.json();
    },
    enabled: !!entityType && !!entityId,
  });

  const events = data?.data || [];

  if (isLoading) {
    return <div className="text-sm text-[var(--color-text-secondary)] py-4 text-center">{t('contacts.loading')}</div>;
  }

  if (events.length === 0) {
    return <div className="text-sm text-[var(--color-text-secondary)] py-4 text-center">{t('timeline.empty')}</div>;
  }

  return (
    <div className="space-y-3">
      {events.map((event) => {
        const Icon = ACTION_ICONS[event.action] || Clock;
        return (
          <div key={event.id} className="flex gap-3">
            <div className="mt-0.5">
              <div className="w-7 h-7 rounded-full bg-[var(--color-accent)]/10 flex items-center justify-center">
                <Icon size={14} className="text-[var(--color-accent)]" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-[var(--color-text)]">
                <span className="font-medium">{event.action}</span>
                {event.metadata?.field && (
                  <span className="text-[var(--color-text-secondary)]">
                    {' '}{event.metadata.field}
                    {event.metadata.from && event.metadata.to && (
                      <span>: {event.metadata.from} → {event.metadata.to}</span>
                    )}
                  </span>
                )}
              </div>
              <div className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                {formatTimeAgo(event.created_at)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
