import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, CheckCircle2, AlertTriangle } from 'lucide-react';

const SLA_TARGET = 300; // 5 min — full progress bar

const ACTIVE_TIMER_STATUSES = ['new', 'chatbot_engaged', 'assigned'];

function ratingFromSeconds(seconds) {
  if (seconds < 300) return { key: 'excellent', text: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200' };
  if (seconds < 900) return { key: 'good', text: 'text-yellow-600', bg: 'bg-yellow-50', border: 'border-yellow-200' };
  if (seconds < 1800) return { key: 'fair', text: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200' };
  return { key: 'slow', text: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' };
}

function barColorFromPct(pct) {
  if (pct >= 100) return 'bg-red-500';
  if (pct >= 80) return 'bg-orange-500';
  if (pct >= 60) return 'bg-yellow-500';
  return 'bg-green-500';
}

function formatDuration(seconds) {
  if (seconds < 0) return '00:00:00';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n) => String(n).padStart(2, '0');
  if (d > 0) return `${d}d ${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function formatResponseTime(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

function ratingLabelKey(key) {
  return `speedToLead.rating${key.charAt(0).toUpperCase() + key.slice(1)}`;
}

export default function SpeedToLeadTimer({ lead, size = 'sm' }) {
  const { t } = useTranslation();
  const isContacted = !!lead?.first_contacted_at;
  const isActiveTimer = !isContacted && ACTIVE_TIMER_STATUSES.includes(lead?.status);

  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isActiveTimer) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isActiveTimer]);

  if (!lead) return null;

  // Case 1: contacted — frozen response time
  if (isContacted) {
    let seconds = lead.response_time_seconds;
    if (seconds == null && lead.created_at && lead.first_contacted_at) {
      seconds = Math.floor((new Date(lead.first_contacted_at) - new Date(lead.created_at)) / 1000);
    }
    if (seconds == null) {
      return <span className="text-xs text-gray-400">—</span>;
    }
    const rating = ratingFromSeconds(seconds);
    const ratingLabel = t(ratingLabelKey(rating.key));
    const formatted = formatResponseTime(seconds);

    if (size === 'sm') {
      return (
        <span className={`inline-flex items-center gap-1 text-xs ${rating.text}`} title={ratingLabel}>
          <CheckCircle2 size={12} />
          {formatted}
        </span>
      );
    }
    if (size === 'md') {
      return (
        <span className={`inline-flex items-center gap-1.5 text-xs ${rating.text}`}>
          <CheckCircle2 size={12} />
          <span>{formatted}</span>
          <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${rating.bg} ${rating.text}`}>
            {ratingLabel}
          </span>
        </span>
      );
    }
    // lg
    return (
      <div className={`rounded-lg border ${rating.border} ${rating.bg} p-3`}>
        <div className="flex items-center justify-between mb-1">
          <div className={`flex items-center gap-2 text-base font-semibold ${rating.text}`}>
            <CheckCircle2 size={18} />
            <span>{t('speedToLead.respondedIn')} {formatted}</span>
          </div>
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${rating.text} bg-white`}>
            {ratingLabel}
          </span>
        </div>
        <div className="text-[11px] text-gray-500">{t('speedToLead.slaTarget')}</div>
      </div>
    );
  }

  // Case 2: live ticking timer (uncontacted + actionable status)
  if (isActiveTimer) {
    const elapsed = Math.max(0, Math.floor((now - new Date(lead.created_at).getTime()) / 1000));
    const rating = ratingFromSeconds(elapsed);
    const ratingLabel = t(ratingLabelKey(rating.key));
    const formatted = formatDuration(elapsed);
    const rawPct = (elapsed / SLA_TARGET) * 100;
    const pct = Math.min(100, rawPct);
    const overflow = rawPct >= 100;
    const pulse = overflow ? 'animate-pulse' : '';
    const barColor = barColorFromPct(rawPct);

    if (size === 'sm') {
      return (
        <span className={`inline-flex items-center gap-1 text-xs font-mono ${rating.text} ${pulse}`} title={ratingLabel}>
          <Zap size={12} />
          {formatted}
        </span>
      );
    }
    if (size === 'md') {
      return (
        <div className={`inline-flex flex-col gap-1 ${pulse}`}>
          <span className={`inline-flex items-center gap-1.5 text-xs font-mono ${rating.text}`}>
            <Zap size={12} />
            <span>{formatted}</span>
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${rating.bg} ${rating.text}`}>
              {ratingLabel}
            </span>
          </span>
        </div>
      );
    }
    // lg
    return (
      <div className={`rounded-lg border ${rating.border} ${rating.bg} p-3 ${pulse}`}>
        <div className="flex items-center justify-between mb-2">
          <div className={`flex items-center gap-2 text-base font-mono font-semibold ${rating.text}`}>
            <Zap size={18} />
            <span>{formatted}</span>
          </div>
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${rating.text} bg-white`}>
            {ratingLabel}
          </span>
        </div>
        <div className="text-[11px] text-gray-500 mb-1">
          {t('speedToLead.liveTimer')} • {t('speedToLead.slaTarget')}
        </div>
        <div className="w-full h-1.5 rounded-full bg-white overflow-hidden">
          <div
            className={`h-full ${barColor} transition-all duration-1000 ease-linear`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  }

  // Case 3: contacted-class status with no first_contacted_at, or terminal status — no data
  if (size === 'lg') {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 flex items-center gap-2 text-sm text-gray-500">
        <AlertTriangle size={16} />
        {t('speedToLead.noData')}
      </div>
    );
  }
  return <span className="text-xs text-gray-400">—</span>;
}
