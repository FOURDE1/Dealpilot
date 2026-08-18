import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../../shared/use-page-title.js';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Label,
  Select,
} from '@dealpilot/ui';
import { ProvinceCA, type ContactT } from '@dealpilot/schemas';
import { ApiError } from '../../shared/api/client.js';
import { ActivityTimeline } from '../activity/activity-timeline.js';
import { formatCents } from '../deals/money.js';
import { PIPELINE_STAGE_KEYS } from '../deals/labels.js';
import { useContact, useContactDeals, useContacts, useMergeContacts, useUpdateContact } from './api.js';
import { contactDisplayName } from './labels.js';

/**
 * FR-CON-006 — the customer's page: properties / activity / their deals.
 *
 * Three columns on wide screens (280px / fluid / 300px per the requirement),
 * stacking to one on mobile. The timeline in the middle is the same component
 * every other entity uses; a contact's history includes what was MERGED into it
 * only by lineage (D-045) — nothing is ever rewritten to pretend the events
 * happened to this record.
 */

interface Draft {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  city: string;
  province: string;
  preferred_language: ContactT['preferred_language'];
  preferred_contact: ContactT['preferred_contact'];
  consent_marketing: boolean;
}

function toDraft(c: ContactT): Draft {
  return {
    first_name: c.first_name ?? '',
    last_name: c.last_name ?? '',
    email: c.email ?? '',
    phone: c.phone ?? '',
    city: c.city ?? '',
    province: c.province ?? '',
    preferred_language: c.preferred_language,
    preferred_contact: c.preferred_contact,
    consent_marketing: c.consent_marketing,
  };
}

export function ContactDetailPage() {
  const { contactId = '' } = useParams();
  const { t, i18n } = useTranslation('contacts');
  const { t: tCommon } = useTranslation('common');
  const { t: tDeals } = useTranslation('deals');
  const navigate = useNavigate();

  const contact = useContact(contactId);
  const orgId = contact.data?.organization_id;
  const deals = useContactDeals(contactId, orgId);
  const updateContact = useUpdateContact(contactId);
  usePageTitle(contact.data ? contactDisplayName(contact.data, t('unnamed')) : t('title'));

  const [draft, setDraft] = useState<Draft | null>(null);
  const [feedback, setFeedback] = useState<'saved' | 'error' | null>(null);
  useEffect(() => {
    // Hydrate once per load; a refetch must not stomp unsaved edits.
    if (contact.data && draft === null) setDraft(toDraft(contact.data));
  }, [contact.data, draft]);

  const [mergeOpen, setMergeOpen] = useState(false);

  if (contact.isError) {
    return (
      <div className="space-y-2">
        <p role="alert" className="text-sm text-danger-text">{t('notFound')}</p>
        <Link to="/contacts" className="text-sm text-primary underline-offset-4 hover:underline">
          {t('backToList')}
        </Link>
      </div>
    );
  }
  if (!contact.data || draft === null) return <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>;
  const c = contact.data;

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => (d === null ? d : { ...d, [key]: value }));
    setFeedback(null);
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (draft === null) return;
    setFeedback(null);
    try {
      await updateContact.mutateAsync({
        // Empty string means "cleared"; the API's optional fields mean "leave
        // alone" when absent, so only send what differs from the record.
        ...(draft.first_name.trim() !== (c.first_name ?? '') ? { first_name: draft.first_name.trim() || undefined } : {}),
        ...(draft.last_name.trim() !== (c.last_name ?? '') ? { last_name: draft.last_name.trim() || undefined } : {}),
        ...(draft.email.trim().toLowerCase() !== (c.email ?? '') ? { email: draft.email.trim().toLowerCase() || undefined } : {}),
        ...(draft.city.trim() !== (c.city ?? '') ? { city: draft.city.trim() || undefined } : {}),
        ...(draft.province !== (c.province ?? '') && draft.province !== '' ? { province: draft.province as ContactT['province'] & string } : {}),
        ...(draft.preferred_language !== c.preferred_language ? { preferred_language: draft.preferred_language } : {}),
        ...(draft.preferred_contact !== c.preferred_contact ? { preferred_contact: draft.preferred_contact } : {}),
        ...(draft.consent_marketing !== c.consent_marketing ? { consent_marketing: draft.consent_marketing } : {}),
      });
      setFeedback('saved');
    } catch {
      setFeedback('error');
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{contactDisplayName(c, t('unnamed'))}</h1>
          <p className="text-sm text-muted-foreground">
            {c.customer_since === null
              ? t('prospectOnly')
              : t('customerSince', {
                  date: new Date(c.customer_since).toLocaleDateString(i18n.language, { year: 'numeric', month: 'long' }),
                })}
          </p>
          <Link to="/contacts" className="text-sm text-primary underline-offset-4 hover:underline">
            {t('backToList')}
          </Link>
        </div>
        <Button type="button" variant="outline" onClick={() => setMergeOpen(true)}>
          {t('mergeOpen')}
        </Button>
      </header>

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)_300px]">
        {/* Properties (FR-CON-006: 280px) */}
        <form onSubmit={(e) => void onSave(e)} className="space-y-3 rounded-lg border border-border p-4" aria-label={t('propertiesTitle')}>
          <h2 className="text-sm font-semibold">{t('propertiesTitle')}</h2>
          <div className="space-y-1">
            <Label htmlFor="cd-first">{t('firstName')}</Label>
            <Input id="cd-first" value={draft.first_name} onChange={(e) => set('first_name', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cd-last">{t('lastName')}</Label>
            <Input id="cd-last" value={draft.last_name} onChange={(e) => set('last_name', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cd-phone">{t('phone')}</Label>
            {/* Read-only: the phone is the duplicate-match key and the SMS
                destination. Changing it is a compliance-adjacent act that gets
                its own affordance later, not a field someone edits in passing. */}
            <Input id="cd-phone" value={draft.phone === '' ? '—' : draft.phone} readOnly aria-readonly="true" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cd-email">{t('email')}</Label>
            <Input id="cd-email" type="email" value={draft.email} onChange={(e) => set('email', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cd-city">{t('city')}</Label>
            <Input id="cd-city" value={draft.city} onChange={(e) => set('city', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cd-province">{t('province')}</Label>
            <Select id="cd-province" value={draft.province} onChange={(e) => set('province', e.target.value)}>
              <option value="">—</option>
              {ProvinceCA.options.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cd-lang">{t('preferredLanguage')}</Label>
            <Select id="cd-lang" value={draft.preferred_language} onChange={(e) => set('preferred_language', e.target.value as Draft['preferred_language'])}>
              <option value="fr-CA">{t('langFr')}</option>
              <option value="en-CA">{t('langEn')}</option>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cd-pref">{t('preferredContact')}</Label>
            <Select id="cd-pref" value={draft.preferred_contact} onChange={(e) => set('preferred_contact', e.target.value as Draft['preferred_contact'])}>
              <option value="text">{t('prefText')}</option>
              <option value="email">{t('prefEmail')}</option>
              <option value="phone">{t('prefPhone')}</option>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <input
              id="cd-consent"
              type="checkbox"
              className="size-4 accent-primary"
              checked={draft.consent_marketing}
              onChange={(e) => set('consent_marketing', e.target.checked)}
            />
            <Label htmlFor="cd-consent">{t('consentMarketing')}</Label>
          </div>
          <p className="text-xs text-muted-foreground">{t('consentNote')}</p>
          <Button type="submit" disabled={updateContact.isPending}>{t('save')}</Button>
          {feedback === 'saved' ? (
            <p role="status" className="text-sm font-medium text-success-text">{t('saved')}</p>
          ) : null}
          {feedback === 'error' ? (
            <p role="alert" className="text-sm text-danger-text">{t('genericError')}</p>
          ) : null}
        </form>

        {/* Activity — the shared timeline, same as leads and deals. */}
        <section aria-label={t('activityTitle')} className="min-w-0 rounded-lg border border-border p-4">
          <h2 className="mb-2 text-sm font-semibold">{t('activityTitle')}</h2>
          <ActivityTimeline entityType="contact" entityId={c.id} organizationId={c.organization_id} />
        </section>

        {/* Associated deals (FR-CON-006: 300px) */}
        <section aria-label={t('dealsTitle')} className="space-y-2 rounded-lg border border-border p-4">
          <h2 className="text-sm font-semibold">{t('dealsTitle')}</h2>
          {deals.data === undefined ? (
            <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
          ) : deals.data.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noDeals')}</p>
          ) : (
            <ul className="space-y-2">
              {deals.data.items.map((d) => (
                <li key={d.id} className="rounded-md border border-border p-2 text-sm">
                  <p className="font-mono tabular-nums">{formatCents(d.sale_price_cents, i18n.language)}</p>
                  <p className="text-xs text-muted-foreground">
                    {tDeals(PIPELINE_STAGE_KEYS[d.pipeline_stage])} · {new Date(d.created_at).toLocaleDateString(i18n.language)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <MergeDialog
        open={mergeOpen}
        onClose={() => setMergeOpen(false)}
        keep={c}
        onMerged={() => {
          setMergeOpen(false);
          void navigate(`/contacts/${c.id}`, { replace: true });
        }}
      />
    </div>
  );
}

/**
 * Folding a duplicate into this record (FR-CON-003).
 *
 * The KEEPER is the page you are on; the search below picks the record that
 * disappears. That direction is fixed on purpose — a dialog where either side
 * could be the survivor is a dialog where somebody merges the wrong way, and
 * there is no unmerge.
 */
function MergeDialog({
  open, onClose, keep, onMerged,
}: {
  open: boolean;
  onClose: () => void;
  keep: ContactT;
  onMerged: () => void;
}) {
  const { t } = useTranslation('contacts');
  const [q, setQ] = useState('');
  const candidates = useContacts(keep.organization_id, { enabled: open, q });
  const merge = useMergeContacts();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ deals: number; leads: number } | null>(null);

  async function onPick(mergeId: string) {
    setError(null);
    try {
      const result = await merge.mutateAsync({ keep_id: keep.id, merge_id: mergeId });
      setDone({ deals: result.moved.deals + result.moved.parties, leads: result.moved.leads });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('genericError'));
    }
  }

  const rows = (candidates.data?.items ?? []).filter((x) => x.id !== keep.id).slice(0, 8);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setQ('');
          setError(null);
          if (done !== null) onMerged();
          setDone(null);
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogTitle>{t('mergeTitle')}</DialogTitle>
        <DialogDescription>
          {t('mergeBody', { name: contactDisplayName(keep, t('unnamed')) })}
        </DialogDescription>

        {done !== null ? (
          <div className="mt-3 space-y-3">
            <p role="status" className="text-sm font-medium text-success-text">
              {t('mergeDone', { deals: done.deals, leads: done.leads })}
            </p>
            <div className="flex justify-end">
              <Dialog.Close render={<Button type="button">{t('close')}</Button>} />
            </div>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <div className="space-y-1">
              <Label htmlFor="merge-q">{t('mergeSearch')}</Label>
              <Input id="merge-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noResults')}</p>
            ) : (
              <ul className="space-y-1">
                {rows.map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-sm">
                    <span>
                      {contactDisplayName(x, t('unnamed'))}
                      <span className="block text-xs text-muted-foreground">{x.phone ?? x.email ?? ''}</span>
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={merge.isPending}
                      onClick={() => void onPick(x.id)}
                    >
                      {t('mergePick')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-warning-text">{t('mergeWarning')}</p>
            {error ? (
              <p role="alert" className="text-sm text-danger-text">{error}</p>
            ) : null}
            <div className="flex justify-end">
              <Dialog.Close render={<Button type="button" variant="outline">{t('cancel')}</Button>} />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog.Root>
  );
}
