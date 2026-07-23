import { useTranslation } from 'react-i18next';
import { useSession } from '../../shared/auth/client.js';

/** Placeholder dashboard — the first feature slice (F-01) fills this shell. */
export function DashboardPage() {
  const { t } = useTranslation('dashboard');
  const { data: session } = useSession();
  const name = session?.user.name || session?.user.email;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{name ? t('greetingName', { name }) : t('greeting')}</h1>
      <div className="rounded-lg border border-border bg-card p-4 text-card-foreground">
        <h2 className="text-[15px] font-semibold">{t('welcomeTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('welcomeBody')}</p>
      </div>
    </div>
  );
}
