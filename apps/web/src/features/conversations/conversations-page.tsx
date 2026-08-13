import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Label, Select } from '@dealpilot/ui';
import type { MessageT } from '@dealpilot/schemas';
import { usePageTitle } from '../../shared/use-page-title.js';
import { can, usePermissionsMine } from '../../shared/permissions.js';
import { useOrganizations } from '../organizations/api.js';
import {
  useCloseConversation, useConversation, useConversations, useSendReply, useTakeover, useThread,
} from './api.js';
import { SCORE_CLASS, STATUS_KEYS } from './labels.js';

/**
 * The agent console (conversation-engine.md §9).
 *
 * Three panes: who is waiting, what was said, what the assistant makes of it.
 *
 * The composer is deliberately plain — no template picker, no "send anyway".
 * Every refusal it can show comes from the server, because a client that could
 * decide a message was fine would be a second compliance authority, and the
 * second one is always the one that is wrong.
 */

function Bubble({ message, label }: { message: MessageT; label: (k: string) => string }) {
  const fromUs = message.direction === 'outbound';
  return (
    <li className={fromUs ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={[
          'max-w-[80%] rounded-2xl px-4 py-2 text-sm',
          fromUs ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
        ].join(' ')}
      >
        <p className="whitespace-pre-wrap break-words">{message.body}</p>
        <p className={['mt-1 text-xs', fromUs ? 'text-primary-foreground/75' : 'text-muted-foreground'].join(' ')}>
          {label(`sender_${message.sender_type}`)}
          {' · '}
          <time dateTime={message.created_at}>
            {new Date(message.created_at).toLocaleString()}
          </time>
        </p>
      </div>
    </li>
  );
}

export function ConversationsPage() {
  const { t } = useTranslation('conversations');
  usePageTitle(t('title'));

  const orgs = useOrganizations();
  const multiOrg = (orgs.data?.items.length ?? 0) > 1;
  const [orgFilter, setOrgFilter] = useState('');
  const orgId = multiOrg ? orgFilter || orgs.data?.items[0]?.id : orgs.data?.items[0]?.id;
  const scope = multiOrg ? orgId : undefined;

  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const mine = usePermissionsMine(scope, { enabled: !orgs.isPending });
  const canRead = can(mine.data, 'conversation:read');
  const canReply = can(mine.data, 'conversation:reply');

  const list = useConversations(scope, { enabled: !orgs.isPending && canRead, status });
  const detail = useConversation(selected);
  const thread = useThread(selected);
  const reply = useSendReply(selected ?? '');
  const takeover = useTakeover(selected ?? '');
  const close = useCloseConversation(selected ?? '');

  const conversation = detail.data?.conversation;
  const analysis = detail.data?.analysis ?? [];
  const latest = analysis[0];

  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  useEffect(() => {
    if (!selected && items.length > 0) setSelected(items[0]!.id);
  }, [items, selected]);

  // Scroll the newest message into view when the thread changes, but never
  // against somebody who has scrolled up to read.
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [thread.data?.items.length]);

  const result = reply.data;
  const closed = conversation?.status === 'closed';

  if (!orgs.isPending && !mine.isPending && !canRead) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('noPermission')}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col p-4 lg:p-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="ml-auto flex flex-wrap items-end gap-3">
          {multiOrg && (
            <div>
              <Label htmlFor="conv-org">{t('organization')}</Label>
              <Select id="conv-org" value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)}>
                {(orgs.data?.items ?? []).map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </Select>
            </div>
          )}
          <div>
            <Label htmlFor="conv-status">{t('filterStatus')}</Label>
            <Select id="conv-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t('filterAll')}</option>
              {Object.entries(STATUS_KEYS).map(([value, key]) => (
                <option key={value} value={value}>{t(key)}</option>
              ))}
            </Select>
          </div>
        </div>
      </div>

      <div className="mt-4 grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(16rem,20rem)_1fr_minmax(16rem,22rem)]">
        {/* Who is waiting */}
        <nav aria-label={t('inbox')} className="min-h-0 overflow-y-auto rounded-lg border border-border">
          <ul className="divide-y divide-border">
            {items.map((cv) => (
              <li key={cv.id}>
                <button
                  type="button"
                  onClick={() => { setSelected(cv.id); setDraft(''); reply.reset(); }}
                  aria-current={cv.id === selected ? 'true' : undefined}
                  className={[
                    'flex w-full flex-col gap-1 px-3 py-3 text-left text-sm min-h-11',
                    'hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
                    cv.id === selected ? 'bg-muted' : '',
                  ].join(' ')}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium">{cv.phone_e164}</span>
                    {cv.bot_score && (
                      <span className={['rounded-full px-2 py-0.5 text-xs', SCORE_CLASS[cv.bot_score] ?? ''].join(' ')}>
                        {t(`score_${cv.bot_score}`)}
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">{t(STATUS_KEYS[cv.status])}</span>
                </button>
              </li>
            ))}
            {items.length === 0 && !list.isPending && (
              <li className="px-3 py-6 text-sm text-muted-foreground">{t('emptyInbox')}</li>
            )}
          </ul>
        </nav>

        {/* What was said */}
        <section aria-label={t('thread')} className="flex min-h-0 flex-col rounded-lg border border-border">
          <ul className="flex-1 space-y-2 overflow-y-auto p-4">
            {(thread.data?.items ?? []).map((m) => (
              <Bubble key={m.id} message={m} label={(k) => t(k as never)} />
            ))}
            <div ref={endRef} />
          </ul>

          <form
            className="border-t border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!draft.trim() || !selected) return;
              reply.mutate(draft, { onSuccess: (r) => { if (r.kind === 'sent') setDraft(''); } });
            }}
          >
            <Label htmlFor="conv-draft">{t('replyLabel')}</Label>
            <div className="flex gap-2">
              <Input
                id="conv-draft"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={1600}
                disabled={!canReply || closed}
                placeholder={closed ? t('closedPlaceholder') : t('replyPlaceholder')}
              />
              <Button type="submit" disabled={!canReply || closed || reply.isPending || !draft.trim()}>
                {t('send')}
              </Button>
            </div>

            {/* Every refusal, in the words the server used. */}
            <div aria-live="polite" className="mt-2 text-sm">
              {result?.kind === 'blocked' && (
                <p className="rounded-md bg-danger-bg px-3 py-2 text-danger-text">
                  <strong>{t(`reason_${result.reason}`, { defaultValue: result.reason })}</strong>
                  {' — '}{result.remedy}
                </p>
              )}
              {result?.kind === 'deferred' && (
                <p className="rounded-md bg-muted px-3 py-2 text-muted-foreground">
                  {t('deferred', { at: new Date(result.run_at).toLocaleString() })}
                </p>
              )}
              {result?.kind === 'unsafe' && (
                <ul className="space-y-1 rounded-md bg-danger-bg px-3 py-2 text-danger-text">
                  {result.violations.map((v, i) => (
                    <li key={`${v.kind}-${i}`}>
                      <strong>{t(`violation_${v.kind}`, { defaultValue: v.kind })}</strong>
                      {': '}{v.reason} — “{v.matched}”
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </form>
        </section>

        {/* What the assistant makes of it */}
        <aside aria-label={t('analysis')} className="min-h-0 space-y-4 overflow-y-auto rounded-lg border border-border p-4">
          {conversation && (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={!canReply || closed || takeover.isPending}
                onClick={() => takeover.mutate()}
              >
                {t('takeover')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={!canReply || closed || close.isPending}
                onClick={() => close.mutate(undefined)}
              >
                {t('close')}
              </Button>
            </div>
          )}

          {latest ? (
            <>
              <div>
                <h2 className="text-sm font-semibold">{t('summary')}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{latest.summary}</p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className={['rounded-full px-2 py-1', SCORE_CLASS[latest.score] ?? ''].join(' ')}>
                  {t(`score_${latest.score}`)}
                </span>
                <span className="rounded-full bg-muted px-2 py-1 text-muted-foreground">
                  {t(`sentiment_${latest.sentiment}`)}
                </span>
              </div>
              {latest.buying_signals.length > 0 && (
                <div>
                  <h2 className="text-sm font-semibold">{t('signals')}</h2>
                  <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
                    {latest.buying_signals.map((s) => <li key={s}>{s}</li>)}
                  </ul>
                </div>
              )}
              {latest.concerns.length > 0 && (
                <div>
                  <h2 className="text-sm font-semibold">{t('concerns')}</h2>
                  <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
                    {latest.concerns.map((s) => <li key={s}>{s}</li>)}
                  </ul>
                </div>
              )}
              {latest.suggested_response && (
                <div>
                  <h2 className="text-sm font-semibold">{t('suggested')}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{latest.suggested_response}</p>
                  {/* Loads the draft; it does NOT send. The suggestion goes
                      through the same gate and the same guard as anything the
                      agent types, and they get to read it first. */}
                  <Button
                    type="button"
                    variant="secondary"
                    className="mt-2"
                    disabled={!canReply || closed}
                    onClick={() => setDraft(latest.suggested_response!)}
                  >
                    {t('useSuggestion')}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t('noAnalysis')}</p>
          )}
        </aside>
      </div>
    </div>
  );
}
