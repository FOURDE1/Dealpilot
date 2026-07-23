import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Phone, MessageSquare, Mail } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL;

const SIZES = {
  xs: { icon: 12, btn: 'p-1.5', gap: 'gap-1', text: '' },
  md: { icon: 14, btn: 'px-3 py-1.5', gap: 'gap-2', text: 'text-xs font-medium' },
};

function WhatsAppIcon({ size = 14 }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21" />
      <path d="M9 10a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1a5 5 0 0 0 5 5h1a.5.5 0 0 0 0-1h-1a.5.5 0 0 0 0 1" />
    </svg>
  );
}

export default function QuickActionButtons({ phone, email, leadId, size = 'xs', className = '' }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const s = SIZES[size] || SIZES.xs;
  const showLabel = size === 'md';
  const digits = phone ? phone.replace(/[^\d+]/g, '') : '';

  const logContactAttempt = (type) => {
    if (!leadId) return;
    fetch(`${API_URL}/leads/${leadId}/communications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, direction: 'outbound', body: null }),
    })
      .then(() => queryClient.invalidateQueries({ queryKey: ['lead-communications', leadId] }))
      .catch(() => {});
  };

  const handle = (e, type) => {
    e.stopPropagation();
    logContactAttempt(type);
  };

  return (
    <div className={`flex items-center ${s.gap} ${className}`}>
      {phone && (
        <a href={`tel:${phone}`} onClick={e => handle(e, 'call')} title={t('quickActions.call')}
          className={`inline-flex items-center gap-1 ${s.btn} rounded-lg bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 transition-colors`}>
          <Phone size={s.icon} />
          {showLabel && <span className={s.text}>{t('quickActions.call')}</span>}
        </a>
      )}
      {phone && (
        <a href={`sms:${phone}`} onClick={e => handle(e, 'sms')} title={t('quickActions.text')}
          className={`inline-flex items-center gap-1 ${s.btn} rounded-lg bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors`}>
          <MessageSquare size={s.icon} />
          {showLabel && <span className={s.text}>{t('quickActions.text')}</span>}
        </a>
      )}
      {phone && (
        <a href={`https://wa.me/${digits}`} onClick={e => handle(e, 'sms')} target="_blank" rel="noopener noreferrer"
          title={t('quickActions.whatsapp', 'WhatsApp')}
          className={`inline-flex items-center gap-1 ${s.btn} rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors`}>
          <WhatsAppIcon size={s.icon} />
          {showLabel && <span className={s.text}>{t('quickActions.whatsapp', 'WhatsApp')}</span>}
        </a>
      )}
      {email && (
        <a href={`mailto:${email}`} onClick={e => handle(e, 'email')} title={t('quickActions.email')}
          className={`inline-flex items-center gap-1 ${s.btn} rounded-lg bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 transition-colors`}>
          <Mail size={s.icon} />
          {showLabel && <span className={s.text}>{t('quickActions.email')}</span>}
        </a>
      )}
    </div>
  );
}
