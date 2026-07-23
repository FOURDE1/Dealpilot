import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '../../shared/i18n/language-switcher.js';

/** Shared chrome for the public auth screens (branded login page, §10). */
export function AuthCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const { t } = useTranslation('common');
  return (
    <div className="relative flex min-h-svh items-center justify-center bg-background p-4 text-foreground">
      <div className="absolute end-4 top-4">
        <LanguageSwitcher />
      </div>
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <p className="text-2xl font-bold">{t('appName')}</p>
          <h1 className="mt-4 text-lg font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="space-y-4 rounded-lg border border-border bg-card p-6">{children}</div>
      </div>
    </div>
  );
}

export function AuthField({
  label,
  type,
  value,
  onChange,
  autoComplete,
  inputMode,
  hint,
  required,
}: {
  label: string;
  type: 'text' | 'email' | 'password';
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  inputMode?: 'email';
  hint?: string;
  required?: boolean;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-[13px] font-medium">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        inputMode={inputMode}
        required={required}
        aria-describedby={hint ? hintId : undefined}
        className="h-10 w-full rounded-md border border-input bg-input-bg px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring max-lg:min-h-11"
      />
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function AuthError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md border border-destructive px-3 py-2 text-sm text-danger-text">
      {message}
    </p>
  );
}
