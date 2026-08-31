import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Label } from '@dealpilot/ui';
import { ApiError } from '../../shared/api/client.js';
import { useStoreTemplate, useUpdateTemplateItem } from './api.js';

/**
 * Store policy for the delivery checklist. Edits apply to deals created AFTER
 * the change — in-flight deals keep their snapshot (say it, or the owner
 * thinks the change didn't work).
 */
export function ChecklistTemplateSection({ storeId }: { storeId: string }) {
  const { t, i18n } = useTranslation('checklist');
  const template = useStoreTemplate(storeId);
  const update = useUpdateTemplateItem(storeId);
  const [error, setError] = useState<string | null>(null);

  function toggle(code: string, active: boolean) {
    setError(null);
    update.mutateAsync({ code, body: { active } }).catch((err: unknown) => {
      if (!(err instanceof ApiError)) {
        setError(t('genericError'));
        throw err;
      }
      setError(err.code === 'hard_block' ? t('hardBlock') : t('genericError'));
    });
  }

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4" aria-labelledby="chk-template-title">
      <div>
        <h2 id="chk-template-title" className="text-[15px] font-semibold">
          {t('templateTitle')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('templateNote')}</p>
      </div>
      {template.isPending ? (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      ) : template.isError ? (
        <p role="alert" className="text-sm text-danger-text">
          {t('loadError')}
        </p>
      ) : (
        <>
          {error ? (
            <p role="alert" className="text-sm text-danger-text">
              {error}
            </p>
          ) : null}
          <ul className="divide-y divide-border">
            {template.data.items.map((item) => {
              const label = i18n.language.startsWith('fr') ? item.label_fr : item.label_en;
              const isSafety = item.code === 'safety';
              return (
                <li key={item.code} className="flex min-h-11 items-center justify-between gap-3 py-1.5">
                  <Label htmlFor={`tmpl-${item.code}`} className="text-sm">
                    {label}
                    {isSafety ? (
                      <span className="ms-2 text-xs text-muted-foreground">{t('safetyLocked')}</span>
                    ) : null}
                  </Label>
                  <input
                    id={`tmpl-${item.code}`}
                    type="checkbox"
                    checked={item.active}
                    disabled={update.isPending || isSafety}
                    onChange={(e) => toggle(item.code, e.target.checked)}
                    className="size-6 accent-primary-text lg:size-4"
                  />
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
