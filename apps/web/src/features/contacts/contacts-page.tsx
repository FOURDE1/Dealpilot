import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../../shared/use-page-title.js';
import { Button, DataTable, Input, Label, Select, type ColumnDef } from '@dealpilot/ui';
import type { ContactT, DuplicateMatchT } from '@dealpilot/schemas';
import { ApiError } from '../../shared/api/client.js';
import { useOrganizations, useStores } from '../organizations/api.js';
import { useContacts, useCreateContact } from './api.js';
import { contactDisplayName } from './labels.js';

/**
 * F-37 — the customer master's front door (FR-CON-004 search, FR-CON-003
 * duplicate reporting).
 *
 * Duplicates are REPORTED after a create, never blocking: two people at one
 * address genuinely share a phone, and a refusal would push the salesperson to
 * invent a fake number — a duplicate nobody can ever find again. The banner
 * links to the existing record so "oh, they're already here" is one click, and
 * the merge lives on the detail page where both records can be seen first.
 */

interface Draft {
  store_id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
}

const INITIAL: Draft = { store_id: '', first_name: '', last_name: '', phone: '', email: '' };

/** +1XXXXXXXXXX from whatever a human typed; null when it is not a NA number. */
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

export function ContactsPage() {
  const { t, i18n } = useTranslation('contacts');
  const { t: tCommon } = useTranslation('common');
  usePageTitle(t('title'));
  const orgs = useOrganizations();
  const multiOrg = (orgs.data?.items.length ?? 0) > 1;
  const [orgFilter, setOrgFilter] = useState('');
  const orgId = multiOrg ? orgFilter || orgs.data?.items[0]?.id : orgs.data?.items[0]?.id;
  const stores = useStores(orgId ?? '');

  const [q, setQ] = useState('');
  const contacts = useContacts(orgId, { enabled: orgId !== undefined, q });

  const [draft, setDraft] = useState<Draft>(INITIAL);
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateMatchT[]>([]);
  const createContact = useCreateContact();

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (!orgId) return;
    setFormError(null);
    setDuplicates([]);

    const phone = draft.phone.trim() === '' ? undefined : normalizePhone(draft.phone);
    if (phone === null) {
      setFormError(t('phoneInvalid'));
      return;
    }
    const email = draft.email.trim() === '' ? undefined : draft.email.trim().toLowerCase();
    if (phone === undefined && email === undefined) {
      // Same rule the API enforces with a 422: a contact reachable by nothing
      // is a note, not a customer. Said here so the message names the fix.
      setFormError(t('needsReach'));
      return;
    }

    try {
      const created = await createContact.mutateAsync({
        organization_id: orgId,
        // The schema's defaults, stated rather than relied on (siblings do the
        // same): FR-first per Bill 96, text-first per the product, and consent
        // FALSE — an absent answer is not a yes, and the quick-create form has
        // no consent question on purpose. Recording consent is the detail
        // page's job, where the note beside the box explains what it is not.
        preferred_language: 'fr-CA',
        preferred_contact: 'text',
        consent_marketing: false,
        ...(draft.store_id === '' ? {} : { store_id: draft.store_id }),
        ...(draft.first_name.trim() === '' ? {} : { first_name: draft.first_name.trim() }),
        ...(draft.last_name.trim() === '' ? {} : { last_name: draft.last_name.trim() }),
        ...(phone === undefined ? {} : { phone }),
        ...(email === undefined ? {} : { email }),
      });
      setDraft(INITIAL);
      setDuplicates(created.duplicates);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t('genericError'));
    }
  }

  const columns = useMemo<ColumnDef<ContactT, unknown>[]>(
    () => [
      {
        id: 'name',
        header: t('colName'),
        cell: ({ row }) => (
          <Link
            to={`/contacts/${row.original.id}`}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {contactDisplayName(row.original, t('unnamed'))}
          </Link>
        ),
      },
      { accessorKey: 'phone', header: t('colPhone'), cell: ({ row }) => row.original.phone ?? '—' },
      { accessorKey: 'email', header: t('colEmail'), cell: ({ row }) => row.original.email ?? '—' },
      { accessorKey: 'city', header: t('colCity'), cell: ({ row }) => row.original.city ?? '—' },
      {
        accessorKey: 'customer_since',
        header: t('colSince'),
        cell: ({ row }) =>
          row.original.customer_since === null
            ? t('prospectOnly')
            : new Date(row.original.customer_since).toLocaleDateString(i18n.language, {
                year: 'numeric', month: 'short',
              }),
      },
    ],
    [t, i18n.language],
  );

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        {multiOrg ? (
          <div className="mt-3 max-w-xs space-y-1">
            <Label htmlFor="contacts-org">{t('orgScope')}</Label>
            <Select id="contacts-org" value={orgId ?? ''} onChange={(e) => setOrgFilter(e.target.value)}>
              {orgs.data?.items.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </Select>
          </div>
        ) : null}
      </header>

      <form onSubmit={(e) => void onCreate(e)} className="grid max-w-4xl gap-3 rounded-lg border border-border p-4 sm:grid-cols-2 lg:grid-cols-3" aria-label={t('createTitle')}>
        <div className="space-y-1">
          <Label htmlFor="ct-first">{t('firstName')}</Label>
          <Input id="ct-first" autoComplete="off" value={draft.first_name} onChange={(e) => set('first_name', e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ct-last">{t('lastName')}</Label>
          <Input id="ct-last" autoComplete="off" value={draft.last_name} onChange={(e) => set('last_name', e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ct-phone">{t('phone')}</Label>
          <Input id="ct-phone" type="tel" inputMode="tel" autoComplete="off" value={draft.phone} onChange={(e) => set('phone', e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ct-email">{t('email')}</Label>
          <Input id="ct-email" type="email" inputMode="email" autoComplete="off" value={draft.email} onChange={(e) => set('email', e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ct-store" optionalText={tCommon('optional')}>{t('store')}</Label>
          <Select id="ct-store" value={draft.store_id} onChange={(e) => set('store_id', e.target.value)}>
            <option value="">{t('groupLevel')}</option>
            {stores.data?.items.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </div>
        <div className="flex items-end">
          <Button type="submit" disabled={createContact.isPending || orgId === undefined}>
            {t('createButton')}
          </Button>
        </div>
        {formError ? (
          <p role="alert" className="text-sm text-danger-text sm:col-span-2 lg:col-span-3">{formError}</p>
        ) : null}
        {duplicates.length > 0 ? (
          <div role="status" className="rounded-md bg-warning-bg p-3 text-sm text-warning-text sm:col-span-2 lg:col-span-3">
            <p className="font-medium">{t('duplicateBanner', { count: duplicates.length })}</p>
            <ul className="mt-1 list-inside list-disc">
              {duplicates.map((d) => (
                <li key={d.contact.id}>
                  <Link to={`/contacts/${d.contact.id}`} className="underline underline-offset-4">
                    {contactDisplayName(d.contact, t('unnamed'))}
                  </Link>{' '}
                  — {d.matched_on.map((m) => t(m === 'phone' ? 'matchedPhone' : 'matchedEmail')).join(', ')}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </form>

      <div className="max-w-md space-y-1">
        <Label htmlFor="ct-search">{t('searchLabel')}</Label>
        <Input
          id="ct-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('searchHint')}
        />
      </div>

      <DataTable
        columns={columns}
        data={contacts.data?.items}
        isPending={contacts.isPending}
        isError={contacts.isError}
        loadingMessage={tCommon('loading')}
        errorMessage={t('genericError')}
        emptyMessage={q.trim() === '' ? t('empty') : t('noResults')}
      />
    </div>
  );
}
