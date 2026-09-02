import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Label, Select } from '@dealpilot/ui';
import { LENDER_CATEGORIES, type LenderCategoryT, type LenderT } from '@dealpilot/schemas';
import { usePageTitle } from '../../shared/use-page-title.js';
import { BackLink } from '../../shared/ui/back-link.js';
import { ApiError } from '../../shared/api/client.js';
import { can, usePermissionsMine } from '../../shared/permissions.js';
import { useOrganizations } from '../organizations/api.js';
import { useCreateLender, useLenders, useUpdateLender } from '../lenders/api.js';
import { CATEGORY_KEYS } from '../lenders/labels.js';

/**
 * F-80 — /settings/lenders: the registry the desking screen picks from
 * (lenders-billofsale.md §1.1; the lost-reasons-page + F-76 form discipline).
 *
 * Members SEE the list (it is their pick-list — the route is member-readable);
 * `lender:manage` gates the WRITE controls only, so the link in sections.ts is
 * unconditional (sections rule 2). Zero-request law: without the permission no
 * write control exists and no request fires that a 403 would answer — the list
 * GET answers 200 for every member.
 *
 * Deactivation is `PATCH { active: false }` through the one update route —
 * no delete anywhere (deals reference lenders from birth; history keeps its
 * name, R15). The duplicate-name 409 lands under the name field (exact-name
 * uniqueness — « TD » and « td » may coexist, D-081/A6).
 */

interface LenderDraft {
  name: string;
  short_name: string;
  category: LenderCategoryT;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  notes: string;
}

const EMPTY: LenderDraft = {
  name: '',
  short_name: '',
  category: 'PRIME',
  contact_name: '',
  contact_email: '',
  contact_phone: '',
  notes: '',
};

const trimmedOrNull = (v: string): string | null => (v.trim() === '' ? null : v.trim());

/** The in-route 23505→409 mapping's client half (duplicate_name, path 'name'). */
export function isDuplicateName(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    err.status === 409 &&
    (err.code === 'duplicate_name' || err.errorCode === 'duplicate_name' || err.fieldPath === 'name')
  );
}

export function LendersPage() {
  const { t } = useTranslation('lenders');
  const { t: tSettings } = useTranslation('settings');
  const { t: tCommon } = useTranslation('common');
  usePageTitle(t('title'));
  const orgs = useOrganizations();
  const multiOrg = (orgs.data?.items.length ?? 0) > 1;
  const [orgFilter, setOrgFilter] = useState('');
  const orgId = multiOrg ? orgFilter || orgs.data?.items[0]?.id : orgs.data?.items[0]?.id;

  const lenders = useLenders(orgId, { enabled: !orgs.isPending, includeInactive: true });
  const mine = usePermissionsMine(orgId, { enabled: !orgs.isPending });
  const canManage = can(mine.data, 'lender:manage');
  const create = useCreateLender();
  const update = useUpdateLender();
  // The row toggles get their own mutation instance so a failed deactivate
  // never paints an error inside the form.
  const toggle = useUpdateLender();

  const [editing, setEditing] = useState<LenderT | null>(null);
  const [draft, setDraft] = useState<LenderDraft>(EMPTY);

  const formMutation = editing ? update : create;
  const nameError = isDuplicateName(formMutation.error) ? t('nameTaken') : null;
  const formError = formMutation.error && !nameError ? t('genericError') : null;

  function set<K extends keyof LenderDraft>(key: K, value: LenderDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function beginEdit(lender: LenderT) {
    create.reset();
    update.reset();
    setEditing(lender);
    setDraft({
      name: lender.name,
      short_name: lender.short_name ?? '',
      category: lender.category,
      contact_name: lender.contact_name ?? '',
      contact_email: lender.contact_email ?? '',
      contact_phone: lender.contact_phone ?? '',
      notes: lender.notes ?? '',
    });
  }

  function cancelEdit() {
    create.reset();
    update.reset();
    setEditing(null);
    setDraft(EMPTY);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (draft.name.trim() === '' || formMutation.isPending) return;
    if (editing) {
      update
        .mutateAsync({
          id: editing.id,
          name: draft.name.trim(),
          short_name: trimmedOrNull(draft.short_name),
          category: draft.category,
          contact_name: trimmedOrNull(draft.contact_name),
          contact_email: trimmedOrNull(draft.contact_email),
          contact_phone: trimmedOrNull(draft.contact_phone),
          notes: trimmedOrNull(draft.notes),
        })
        .then(() => {
          setEditing(null);
          setDraft(EMPTY);
        })
        .catch((err: unknown) => {
          if (!(err instanceof ApiError)) throw err;
        });
    } else {
      if (!orgId) return;
      create
        .mutateAsync({
          organization_id: orgId,
          name: draft.name.trim(),
          category: draft.category,
          ...(draft.short_name.trim() === '' ? {} : { short_name: draft.short_name.trim() }),
          ...(draft.contact_name.trim() === '' ? {} : { contact_name: draft.contact_name.trim() }),
          ...(draft.contact_email.trim() === '' ? {} : { contact_email: draft.contact_email.trim() }),
          ...(draft.contact_phone.trim() === '' ? {} : { contact_phone: draft.contact_phone.trim() }),
          ...(draft.notes.trim() === '' ? {} : { notes: draft.notes.trim() }),
        })
        .then(() => setDraft(EMPTY))
        .catch((err: unknown) => {
          if (!(err instanceof ApiError)) throw err;
        });
    }
  }

  function toggleActive(lender: LenderT) {
    toggle.mutateAsync({ id: lender.id, active: !lender.active }).catch((err: unknown) => {
      if (!(err instanceof ApiError)) throw err;
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BackLink to="/settings">{tSettings('title')}</BackLink>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      {multiOrg ? (
        <div className="max-w-xs space-y-1">
          <Label htmlFor="lenders-org">{t('orgScope')}</Label>
          <Select id="lenders-org" value={orgId ?? ''} onChange={(e) => setOrgFilter(e.target.value)}>
            {orgs.data?.items.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </div>
      ) : null}

      {mine.isSuccess && !canManage ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('readOnly')}
        </p>
      ) : null}

      {canManage ? (
        <form onSubmit={submit} noValidate className="space-y-4 rounded-lg border border-border bg-card p-4">
          <h2 className="text-[15px] font-semibold">{editing ? t('editing', { name: editing.name }) : t('add')}</h2>
          <div className="space-y-1">
            <Label htmlFor="lender-name">{t('nameLabel')}</Label>
            <Input
              id="lender-name"
              value={draft.name}
              maxLength={120}
              required
              autoComplete="off"
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? 'lender-name-error' : undefined}
              className={nameError ? 'border-danger-border' : undefined}
              onChange={(e) => set('name', e.target.value)}
            />
            {nameError ? (
              <p id="lender-name-error" role="alert" className="text-xs text-danger-text">
                {nameError}
              </p>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="lender-short" optionalText={tCommon('optional')}>
              {t('shortLabel')}
            </Label>
            <Input
              id="lender-short"
              value={draft.short_name}
              maxLength={20}
              autoComplete="off"
              onChange={(e) => set('short_name', e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lender-category">{t('categoryLabel')}</Label>
            <Select
              id="lender-category"
              value={draft.category}
              onChange={(e) => set('category', e.target.value as LenderCategoryT)}
            >
              {LENDER_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(CATEGORY_KEYS[c])}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="lender-contact-name" optionalText={tCommon('optional')}>
              {t('contactNameLabel')}
            </Label>
            <Input
              id="lender-contact-name"
              value={draft.contact_name}
              maxLength={120}
              autoComplete="off"
              onChange={(e) => set('contact_name', e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lender-contact-email" optionalText={tCommon('optional')}>
              {t('contactEmailLabel')}
            </Label>
            <Input
              id="lender-contact-email"
              type="email"
              value={draft.contact_email}
              maxLength={254}
              autoComplete="off"
              onChange={(e) => set('contact_email', e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lender-contact-phone" optionalText={tCommon('optional')}>
              {t('contactPhoneLabel')}
            </Label>
            <Input
              id="lender-contact-phone"
              type="tel"
              value={draft.contact_phone}
              maxLength={30}
              autoComplete="off"
              onChange={(e) => set('contact_phone', e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lender-notes" optionalText={tCommon('optional')}>
              {t('notesLabel')}
            </Label>
            <Input
              id="lender-notes"
              value={draft.notes}
              maxLength={500}
              autoComplete="off"
              onChange={(e) => set('notes', e.target.value)}
            />
          </div>
          {formError ? (
            <p role="alert" className="text-sm text-danger-text">
              {formError}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={formMutation.isPending || draft.name.trim() === ''}>
              {formMutation.isPending ? t('saving') : editing ? t('save') : t('add')}
            </Button>
            {editing ? (
              <Button type="button" variant="outline" onClick={cancelEdit}>
                {t('cancel')}
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}

      {toggle.error ? (
        <p role="alert" className="text-sm text-danger-text">
          {t('genericError')}
        </p>
      ) : null}

      {lenders.isPending || orgs.isPending ? (
        <p className="text-sm text-muted-foreground" aria-busy="true">
          {t('loading')}
        </p>
      ) : lenders.isError ? (
        <p role="alert" className="text-sm text-danger-text">
          {t('loadError')}
        </p>
      ) : (
        LENDER_CATEGORIES.map((category) => {
          const rows = lenders.data.items.filter((l) => l.category === category);
          if (rows.length === 0) return null;
          return (
            <section key={category} aria-labelledby={`lenders-h-${category}`} className="space-y-2">
              <h2 id={`lenders-h-${category}`} className="text-[15px] font-semibold">
                {t(CATEGORY_KEYS[category])}
              </h2>
              <ul className="divide-y divide-border rounded-lg border border-border bg-card">
                {rows.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 p-3 text-sm">
                    <span className="space-y-0.5">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{l.name}</span>
                        {l.short_name !== null ? (
                          <span className="text-muted-foreground">« {l.short_name} »</span>
                        ) : null}
                        {!l.active ? (
                          <span className="inline-flex rounded-md bg-secondary px-2 py-0.5 text-[11px] font-semibold text-secondary-foreground">
                            {t('inactive')}
                          </span>
                        ) : null}
                      </span>
                      {l.contact_name !== null || l.contact_email !== null || l.contact_phone !== null ? (
                        <span className="block text-xs text-muted-foreground">
                          {[l.contact_name, l.contact_email, l.contact_phone].filter((v) => v !== null).join(' · ')}
                        </span>
                      ) : null}
                      {l.notes !== null ? <span className="block text-xs text-muted-foreground">{l.notes}</span> : null}
                    </span>
                    {canManage ? (
                      <span className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          aria-label={`${t('edit')} — ${l.name}`}
                          onClick={() => beginEdit(l)}
                        >
                          {t('edit')}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={toggle.isPending}
                          aria-label={`${l.active ? t('deactivate') : t('reactivate')} — ${l.name}`}
                          onClick={() => toggleActive(l)}
                        >
                          {l.active ? t('deactivate') : t('reactivate')}
                        </Button>
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
