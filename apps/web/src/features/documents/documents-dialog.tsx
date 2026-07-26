import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, DialogContent, DialogTitle } from '@dealpilot/ui';
import type { DealDocumentT, DealT } from '@dealpilot/schemas';
import { ApiError } from '../../shared/api/client.js';
import { useMembers } from '../team/api.js';
import { can, usePermissionsMine } from '../../shared/permissions.js';
import { useDealDocuments, useUpdateDocument } from './api.js';
import {
  docPrepared,
  DOCUMENT_ACTION_KEYS,
  DOCUMENT_STATUS_KEYS,
  documentDisplayName,
  isSigningMove,
  nextDocumentStatuses,
} from './labels.js';

/**
 * F-13: the deal's paper file — which documents this deal needs (derived from
 * the deal itself), where each one is in its lifecycle, and whether the file
 * is ready to travel. This is what the dispatch gate reads, so the panel's
 * job is to make "why can't I book?" answerable at a glance.
 */
export function DocumentsDialog({
  deal,
  dealLabel,
  onClose,
}: {
  deal: DealT | null;
  dealLabel?: string;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation('documents');
  const docs = useDealDocuments(deal?.id ?? '', { enabled: deal !== null });
  const members = useMembers(deal?.organization_id, { enabled: deal !== null });
  // Evidence keeps naming its author even after they leave the org (F-08 rule).
  const removed = useMembers(deal?.organization_id, { enabled: deal !== null, status: 'revoked' });
  const mine = usePermissionsMine(deal?.organization_id, { enabled: deal !== null });
  const canPrepare = can(mine.data, 'document:prepare');
  const canSign = can(mine.data, 'document:sign');
  const update = useUpdateDocument();
  const [error, setError] = useState<string | null>(null);

  const memberName = (id: string | null) =>
    id === null
      ? null
      : (members.data?.items.find((m) => m.user_id === id)?.name ??
        removed.data?.items.find((m) => m.user_id === id)?.name ??
        null);
  const when = (iso: string | null) =>
    iso === null
      ? ''
      : new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
          new Date(iso),
        );
  const docName = (d: DealDocumentT) => documentDisplayName(d, t);

  async function move(doc: DealDocumentT, status: DealDocumentT['status']) {
    setError(null);
    try {
      await update.mutateAsync({ id: doc.id, body: { status } });
      // The clicked button unmounts as the row re-renders — keep the keyboard
      // on this document's next action (or the row itself when it is done).
      requestAnimationFrame(() => {
        const row = document.getElementById(`doc-row-${doc.id}`);
        ((row?.querySelector('button') ?? row) as HTMLElement | null)?.focus();
      });
    } catch (err) {
      if (!(err instanceof ApiError)) {
        setError(t('genericError'));
        throw err;
      }
      setError(
        err.status === 403
          ? t('notAllowed')
          : err.code === 'invalid_transition'
            ? t('invalidTransition')
            : t('genericError'),
      );
    }
  }

  const data = docs.data;
  const outstanding = data?.items.filter((d) => !docPrepared(d)).length ?? 0;

  return (
    <Dialog.Root open={deal !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-h-[85svh] overflow-y-auto">
        <DialogTitle>
          {t('title')}
          {dealLabel ? <span className="text-muted-foreground"> — {dealLabel}</span> : null}
        </DialogTitle>
        {docs.isPending && deal ? (
          <p className="mt-3 text-sm text-muted-foreground">{t('loading')}</p>
        ) : docs.isError ? (
          <p role="alert" className="mt-3 text-sm text-danger-text">
            {t('loadError')}
          </p>
        ) : data && data.items.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t('noList')}</p>
        ) : data ? (
          <div className="mt-3 space-y-3">
            {data.wet_ink_complete === true ? (
              <p role="status" className="rounded-md bg-success-bg px-3 py-2 text-sm font-medium text-success-text">
                {t('completeBanner')}
              </p>
            ) : data.wet_ink_prepared === true ? (
              <p role="status" className="rounded-md bg-success-bg px-3 py-2 text-sm font-medium text-success-text">
                {t('readyBanner')}
              </p>
            ) : (
              <p role="status" className="rounded-md bg-warning-bg px-3 py-2 text-sm text-warning-text">
                {t('outstandingBanner', { count: outstanding })}
              </p>
            )}
            {error ? (
              <p role="alert" className="text-sm text-danger-text">
                {error}
              </p>
            ) : null}
            <ul className="divide-y divide-border">
              {data.items.map((doc) => {
                const name = docName(doc);
                const targets = nextDocumentStatuses(doc).filter((to) =>
                  isSigningMove(to) ? canSign : canPrepare,
                );
                return (
                  <li key={doc.id} id={`doc-row-${doc.id}`} tabIndex={-1} className="space-y-1 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <span className="flex items-center gap-2 text-sm">
                        <span className={docPrepared(doc) ? undefined : 'font-medium'}>{name}</span>
                        {doc.requires_signature ? null : (
                          <span className="text-xs text-muted-foreground">({t('infoOnly')})</span>
                        )}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                          doc.status === 'signed' || doc.status === 'filed'
                            ? 'bg-success-bg text-success-text'
                            : doc.status === 'not_ready'
                              ? 'bg-warning-bg text-warning-text'
                              : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {t(DOCUMENT_STATUS_KEYS[doc.status])}
                      </span>
                    </div>
                    {doc.printed_at || doc.esign_signed_at || doc.signed_at_delivery || doc.filed_at ? (
                      <p className="text-xs text-muted-foreground">
                        {[
                          doc.printed_at
                            ? t('printedByAt', {
                                name: memberName(doc.printed_by) ?? t('formerMember'),
                                at: when(doc.printed_at),
                              })
                            : null,
                          doc.esign_signed_at ? t('eSignedAt', { at: when(doc.esign_signed_at) }) : null,
                          doc.signed_at_delivery ? t('signedAt', { at: when(doc.signed_at_delivery) }) : null,
                          doc.filed_at
                            ? t('filedByAt', {
                                name: memberName(doc.filed_by) ?? t('formerMember'),
                                at: when(doc.filed_at),
                              })
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    ) : null}
                    {targets.length > 0 ? (
                      <span className="flex flex-wrap gap-1">
                        {targets.map((to) => (
                          <Button
                            key={to}
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={update.isPending}
                            aria-label={t('actFor', { action: t(DOCUMENT_ACTION_KEYS[to]), name })}
                            onClick={() => void move(doc, to)}
                          >
                            {t(DOCUMENT_ACTION_KEYS[to])}
                          </Button>
                        ))}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        <div className="mt-4 flex justify-between gap-2">
          {data && data.items.length > 0 ? (
            <Button type="button" variant="outline" onClick={() => window.print()}>
              {t('printSheet')}
            </Button>
          ) : (
            <span />
          )}
          <Dialog.Close
            render={
              <Button type="button" variant="outline">
                {t('close')}
              </Button>
            }
          />
        </div>
      </DialogContent>
      {/* The wet-ink sheet (§6): what actually travels with the driver. Print
          CSS in styles/app.css shows ONLY this block; portaled to <body> so no
          dialog transform/overflow can clip it on paper. */}
      {deal !== null && data && data.items.length > 0
        ? createPortal(
          <div className="print-sheet hidden">
            <h1 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '2px' }}>
              {t('sheetTitle')}
              {dealLabel ? ` — ${dealLabel}` : ''}
            </h1>
            <p style={{ fontSize: '12px', marginBottom: '12px' }}>
              {new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long' }).format(new Date())}
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <tbody>
                {data.items.map((doc) => (
                  <tr key={doc.id} style={{ borderBottom: '1px solid #999' }}>
                    <td style={{ padding: '8px 8px 8px 0', width: '24px' }}>
                      <span
                        aria-hidden="true"
                        style={{
                          display: 'inline-block',
                          width: '14px',
                          height: '14px',
                          border: '1.5px solid #000',
                        }}
                      >
                        {docPrepared(doc) ? '✕' : ''}
                      </span>
                    </td>
                    <td style={{ padding: '8px 8px 8px 0' }}>
                      {docName(doc)}
                      {doc.requires_signature ? '' : ` (${t('infoOnly')})`}
                    </td>
                    <td style={{ padding: '8px 0', textAlign: 'right' }}>
                      {t(DOCUMENT_STATUS_KEYS[doc.status])}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: '12px', marginTop: '16px' }}>{t('sheetFootnote')}</p>
          </div>,
          document.body,
        )
        : null}
    </Dialog.Root>
  );
}
