import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { BackLink } from '../../shared/ui/back-link.js';
import { useTranslation } from 'react-i18next';
import { Button, Input, Label, Select } from '@dealpilot/ui';
import type { Locale } from '@dealpilot/i18n';
import { useCreateOrganization } from './api.js';
import { formErrorMessage } from './form-error.js';

/**
 * Suggest a slug from the name; the field stays editable (immutable later).
 * Trailing hyphens are stripped AFTER the length cap so a truncated
 * suggestion can never end in '-' (invalid per the schema).
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 40)
    .replace(/^-+|-+$/g, '');
}

export function OrganizationNewPage() {
  const { t } = useTranslation('orgs');
  const navigate = useNavigate();
  const createOrg = useCreateOrganization();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [locale, setLocale] = useState<Locale>('fr-CA');
  const [error, setError] = useState<string | null>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (error) alertRef.current?.focus();
  }, [error]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const org = await createOrg.mutateAsync({ name, slug, default_locale: locale });
      navigate(`/organizations/${org.id}`, { replace: true });
    } catch (err) {
      setError(formErrorMessage(t, err, 'slug'));
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <BackLink to={"/organizations"}>{t('back')}</BackLink>
      <h1 className="text-2xl font-semibold">{t('newOrg')}</h1>
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="space-y-4 rounded-lg border border-border bg-card p-6"
        noValidate
      >
        <div className="space-y-1">
          <Label htmlFor="org-name">{t('name')}</Label>
          <Input
            id="org-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="org-slug">{t('slug')}</Label>
          <Input
            id="org-slug"
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
            aria-describedby="org-slug-hint"
            className="font-mono"
            required
          />
          <p id="org-slug-hint" className="text-xs text-muted-foreground">
            {t('slugHint')}
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="org-locale">{t('defaultLocale')}</Label>
          <Select id="org-locale" value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
            <option value="fr-CA">{t('localeFr')}</option>
            <option value="en-CA">{t('localeEn')}</option>
          </Select>
        </div>
        {error ? (
          <p
            ref={alertRef}
            tabIndex={-1}
            role="alert"
            className="rounded-md border border-danger-border px-3 py-2 text-sm text-danger-text"
          >
            {error}
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={createOrg.isPending}>
          {createOrg.isPending ? t('saving') : t('create')}
        </Button>
      </form>
    </div>
  );
}
