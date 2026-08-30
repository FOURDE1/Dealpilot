import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router';
import { createI18n, enCA, frCA, type Locale } from '@dealpilot/i18n';
import { JOB_QUEUES, JOB_QUEUE_NAMES, type QueueNameT } from '@dealpilot/contracts';
import { RetryOutcome, type QueueStateT } from '@dealpilot/schemas';

/**
 * F-73 §9 — the two ways this screen could lie, held shut by a test.
 *
 * "We could not reach Redis" and "nothing has failed" render as the same empty
 * table unless something forces them apart; and an organization filter on a
 * queue whose payload carries no organization would return an empty page that
 * reads as "this tenant has no failures" — a lie by construction on four of
 * the ten queues. Neither is visible in a type, so both are read out of the
 * rendered markup.
 *
 * The retry form is held to the same standard and one harder: the sentence
 * warning that a requeue can text a real customer twice is the ONLY thing
 * standing between a tired operator and a CASL complaint, so it is asserted
 * verbatim, in both languages, and the outcome words are asserted to be words
 * rather than colours.
 */

type QueueRow = { name: QueueNameT; org_scoped: boolean; queue_state: QueueStateT; counts: Record<string, number> | null };
type DlqPage = {
  queue: QueueNameT;
  queue_state: QueueStateT;
  org_scoped: boolean;
  paging_basis: 'position';
  scanned: number;
  items: { job_id: string; job_name: string; attempts_made: number; enqueued_at: string | null; failed_at: string | null; failed_reason: string | null; first_stack_line: string | null; fields: { key: string; value: string }[] }[];
  next_cursor: string | null;
};

const rows = (state: QueueStateT): QueueRow[] =>
  JOB_QUEUE_NAMES.map((name) => ({
    name,
    org_scoped: JOB_QUEUES[name].org_scoped,
    queue_state: state,
    counts: state === 'ok' ? { waiting: 0, active: 0, failed: 2, delayed: 0, completed: 0 } : null,
  }));

const state: { queues: QueueRow[]; dlq: DlqPage; laterPages: DlqPage[] } = {
  queues: rows('ok'),
  // Pages beyond the first. `unreachable` on any of them carries no cursor, so
  // the load-more button is gone and the list would otherwise read as complete.
  laterPages: [],
  dlq: {
    queue: 'deferred-send',
    queue_state: 'ok',
    org_scoped: true,
    paging_basis: 'position',
    scanned: 2,
    items: [
      {
        job_id: '42',
        job_name: 'deferred-send',
        attempts_made: 3,
        enqueued_at: '2026-08-30T11:00:00.000Z',
        failed_at: '2026-08-30T11:04:00.000Z',
        failed_reason: 'The To number +15145550123 is not valid',
        first_stack_line: 'at deliverMessage (deferred-send.ts:118)',
        fields: [{ key: 'organization_id', value: '11111111-1111-4111-8111-111111111111' }],
      },
    ],
    next_cursor: null,
  },
};

vi.mock('./api.js', () => ({
  useRetryDlqJobs: () => ({ mutate: () => undefined, isPending: false, isError: false, data: undefined }),
  useAdminQueues: () => ({ data: { items: state.queues }, isPending: false, isError: false, isSuccess: true }),
  useAdminDlq: () => ({
    data: { pages: [state.dlq, ...state.laterPages] },
    isPending: false,
    isError: false,
    isSuccess: true,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: () => undefined,
  }),
}));

const { QueueDlqPage, QueuesPage } = await import('./queues-page.js');
const { RetryJobsForm } = await import('./retry-jobs-dialog.js');

function listMarkup(locale: Locale): string {
  const i18n = createI18n({ locale, strictIcu: true });
  return renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(MemoryRouter, { initialEntries: ['/admin/queues'] }, createElement(QueuesPage)),
    ),
  );
}

function dlqMarkup(locale: Locale, queue: string): string {
  const i18n = createI18n({ locale, strictIcu: true });
  return renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(
        MemoryRouter,
        { initialEntries: [`/admin/queues/${queue}`] },
        createElement(Routes, null, createElement(Route, { path: '/admin/queues/:queueName', element: createElement(QueueDlqPage) })),
      ),
    ),
  );
}

const jobs = ((frCA as Record<string, unknown>)['jobs'] ?? {}) as Record<string, string>;
function copy(key: string): string {
  expect(jobs[key]?.trim(), `fr-CA jobs:${key}`).toBeTruthy();
  return jobs[key] as string;
}

const jobsEn = ((enCA as Record<string, unknown>)['jobs'] ?? {}) as Record<string, string>;
function copyEn(key: string): string {
  expect(jobsEn[key]?.trim(), `en-CA jobs:${key}`).toBeTruthy();
  return jobsEn[key] as string;
}

function formMarkup(locale: Locale, queue: QueueNameT, over: Record<string, unknown> = {}): string {
  const i18n = createI18n({ locale, strictIcu: true });
  return renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(RetryJobsForm, {
        queue,
        jobIds: ['42'],
        onSubmit: () => undefined,
        onCancel: () => undefined,
        ...over,
      } as never),
    ),
  );
}

describe('the job inspector never renders "could not ask" as "nothing failed"', () => {
  it('says why the counts are missing, and shows unknown rather than zero', () => {
    state.queues = rows('not_configured');
    const html = listMarkup('fr-CA');
    expect(html).toContain(copy('stateNotConfiguredHelp'));
    expect(html).toContain(copy('state_not_configured'));
    // The whole point: an unconfigured queue must not offer a 0 to walk away from.
    expect(html).toContain(copy('countsUnknown'));
    expect(html).not.toContain('>0<');
    state.queues = rows('ok');
  });

  it('says the queue did not answer when it is configured but unreachable', () => {
    state.queues = rows('unreachable');
    const html = listMarkup('fr-CA');
    expect(html).toContain(copy('stateUnreachableHelp'));
    expect(html).toContain(copy('state_unreachable'));
    expect(html).not.toContain(copy('stateNotConfiguredHelp'));
    state.queues = rows('ok');
  });

  it('names all ten queues in the reader\'s language, never the Redis key', () => {
    const html = listMarkup('fr-CA');
    for (const name of JOB_QUEUE_NAMES) {
      expect(html, name).toContain(copy(`queue_${name}`));
    }
    // The raw name still addresses the drill-in link, but it is never the label.
    expect(html).not.toContain('>deferred-send<');
  });

  it('carries no banner at all when every queue answered', () => {
    const html = listMarkup('fr-CA');
    expect(html).not.toContain(copy('stateNotConfiguredHelp'));
    expect(html).not.toContain(copy('stateUnreachableHelp'));
    // The status region stays in the tree so a later refetch can announce into
    // it — what it must not do is stand there holding stale words.
    expect(html).toContain('role="status"');
  });
});

describe('the failed set offers a tenant filter only where a tenant exists', () => {
  it('offers the filter on a queue whose payload carries an organization', () => {
    expect(JOB_QUEUES['deferred-send'].org_scoped).toBe(true);
    const html = dlqMarkup('fr-CA', 'deferred-send');
    expect(html).toContain(copy('orgFilterLabel'));
    expect(html).not.toContain(copy('orgFilterUnavailable'));
  });

  it('replaces it with the reason on every queue that carries none', () => {
    for (const name of JOB_QUEUE_NAMES.filter((n) => !JOB_QUEUES[n].org_scoped)) {
      const html = dlqMarkup('fr-CA', name);
      // Not a disabled input and not an empty result — the sentence, because an
      // empty page would read as "this tenant has no failures".
      expect(html, name).toContain(copy('orgFilterUnavailable'));
      expect(html, name).not.toContain(copy('orgFilterLabel'));
      // Named, not "no <input> anywhere": the selection checkboxes are inputs
      // too, and a blanket ban would pass by accident the day the filter came
      // back under a different tag. This is the filter's own field and its own
      // form, and neither may exist on a queue that has no tenant to filter by.
      expect(html, name).not.toContain('id="dlq-org"');
      expect(html, name).not.toContain('role="search"');
    }
    // And this is not a vacuous loop: four of the ten are unscoped.
    expect(JOB_QUEUE_NAMES.filter((n) => !JOB_QUEUES[n].org_scoped)).toHaveLength(4);
  });

  it('states that the list is identifiers only and paged by position', () => {
    const html = dlqMarkup('fr-CA', 'deferred-send');
    expect(html).toContain(copy('noPayload'));
    expect(html).toContain(copy('pagingPositional'));
  });
});
/**
 * F-73 §9 — the retry, and the one sentence that has to reach a human.
 *
 * The form is rendered on its own rather than through the dialog because the
 * dialog is a PORTAL and `renderToStaticMarkup` renders nothing inside one —
 * so testing through it would assert an empty string and pass for ever.
 */
describe('the retry form says, in words, that a customer may be texted twice', () => {
  it('warns on every queue whose worker can reach a carrier, in both languages', () => {
    const duplicating = JOB_QUEUE_NAMES.filter((n) => JOB_QUEUES[n].replay === 'at_least_once');
    // Not a vacuous loop: four of the ten, and the same four the server gates.
    expect(duplicating.sort()).toEqual(['assistant-turn', 'deferred-send', 'drip-tick', 'first-touch']);
    for (const name of duplicating) {
      const fr = formMarkup('fr-CA', name);
      expect(fr, name).toContain(copy('retryDuplicateWarning'));
      // The confirm field is offered here and nowhere else — and the queue's
      // own name is in the label, because typing it is the point.
      expect(fr, name).toContain(copy('retryConfirmLabel').replace('{queue}', name));
      expect(fr, name).not.toContain(copy('retryReplaySafe'));
      expect(formMarkup('en-CA', name), name).toContain(copyEn('retryDuplicateWarning'));
    }
  });

  it('asks nothing extra of a queue whose worker cannot re-send, and says why', () => {
    for (const name of JOB_QUEUE_NAMES.filter((n) => JOB_QUEUES[n].replay === 'idempotent')) {
      const html = formMarkup('fr-CA', name);
      expect(html, name).toContain(copy('retryReplaySafe'));
      expect(html, name).not.toContain(copy('retryDuplicateWarning'));
      // No confirm box at all — a field that would accept anything is a field
      // that teaches the operator the typing is decoration.
      expect(html, name).not.toContain('id="retry-confirm"');
    }
  });

  it('always asks for a reason, and says the register keeps it', () => {
    const html = formMarkup('fr-CA', 'qa-review');
    expect(html).toContain(copy('retryReason'));
    expect(html).toContain(copy('retryReasonHint'));
    expect(html).toContain('id="retry-reason"');
  });

  it('names every outcome in words — colour is never the only signal', () => {
    const outcomes = {
      queue_state: 'ok',
      outcomes: RetryOutcome.options.map((retry_outcome, i) => ({ job_id: `job-${i}`, retry_outcome })),
    };
    const html = formMarkup('fr-CA', 'deferred-send', { outcomes });
    for (const outcome of RetryOutcome.options) {
      expect(html, outcome).toContain(copy(`outcome_${outcome}`));
    }
    // The two an operator most easily misreads get a sentence, not a hue.
    expect(html).toContain(copy('outcomesHelp'));
    // And the form stops asking once it has answered: re-offering submit
    // beside a result list is how the same ids get sent a second time.
    expect(html).not.toContain(copy('retrySubmit'));
  });

  it('announces the outcome and does not label the finished action "cancel"', () => {
    const outcomes = { queue_state: 'ok', outcomes: [{ job_id: 'job-0', retry_outcome: 'retried' as const }] };
    for (const locale of ['fr-CA', 'en-CA'] as const) {
      const html = formMarkup(locale, 'deferred-send', { outcomes });
      const jobsBundle = ((locale === 'fr-CA' ? frCA : enCA) as Record<string, Record<string, string>>)['jobs'] as Record<string, string>;
      // Success is the one outcome the failure path already announces and this
      // one did not: up to twenty customers may have just been texted again.
      expect(html, locale).toContain('role="status"');
      // Focusable, because a live region inserted with its content is not
      // reliably spoken and the button that had focus is gone.
      expect(html, locale).toContain('tabindex="-1"');
      // The jobs are already back on the queue: "Cancel" beside "put back on
      // the queue" reads as an undo the product cannot perform.
      expect(html, locale).toContain(jobsBundle['retryDone']);
      expect(html, locale).not.toContain(jobsBundle['retryCancel']);
    }
  });

  it('shows the ids it is about to submit, not only a tally', () => {
    const html = formMarkup('fr-CA', 'deferred-send', { jobIds: ['42', '43'] });
    // A count is not something an operator can check against the list they
    // ticked — and the list may since have been filtered to another tenant.
    expect(html).toContain('>42<');
    expect(html).toContain('>43<');
  });
});

describe('a page the console could not fetch is never the end of the list', () => {
  it('says the queue stopped answering even when it was page two that failed', () => {
    // Page 1 answered; Redis then went away. `next_cursor` is null on the
    // unreachable page, so "load more" is gone and every remaining failure is
    // invisible — the reader must be told, or the list reads as complete.
    state.laterPages = [{ ...state.dlq, queue_state: 'unreachable', scanned: 0, items: [], next_cursor: null }];
    try {
      const html = dlqMarkup('fr-CA', 'deferred-send');
      expect(html).toContain(copy('stateUnreachableHelp'));
      // And the reassuring count of what WAS read is not offered beside it.
      expect(html).not.toContain(copy('scannedCaption').split('}} ')[1]);
    } finally {
      state.laterPages = [];
    }
  });

  it('still shows the scan caption when every loaded page answered', () => {
    const html = dlqMarkup('fr-CA', 'deferred-send');
    expect(html).not.toContain(copy('stateUnreachableHelp'));
    expect(html).not.toContain(copy('stateNotConfiguredHelp'));
  });
});

describe('a queue name that does not exist is a 404, not an outage', () => {
  it('says the queue does not exist rather than telling the operator to retry', () => {
    // Nothing was requested — `useAdminDlq` is disabled on this path — so
    // "Could not load the data. Try again." instructs the one action that
    // cannot work, and reads as an outage rather than a bad link.
    for (const locale of ['fr-CA', 'en-CA'] as const) {
      const html = dlqMarkup(locale, 'deferred_send');
      const bundle = ((locale === 'fr-CA' ? frCA : enCA) as Record<string, Record<string, string>>);
      expect(html, locale).toContain(bundle['jobs']?.['queueUnknown']);
      expect(html, locale).not.toContain(bundle['admin']?.['loadError']);
    }
  });
});

describe('the failed page offers the retry only where there is a queue to retry on', () => {
  it('offers a named checkbox per row and a retry button', () => {
    const html = dlqMarkup('fr-CA', 'deferred-send');
    expect(html).toContain(copy('retryColSelect'));
    // Every box carries the job it selects: a column of unlabelled checkboxes
    // is unreadable to a screen reader on the one screen where the wrong tick
    // texts a stranger.
    expect(html).toContain(copy('retrySelectJob').replace('{jobId}', '42'));
    expect(html).toContain(copy('retryButton'));
    expect(html).toContain(copy('retryMax'));
  });

  it('replaces the button with the reason when no queue is configured', () => {
    const was = state.dlq.queue_state;
    state.dlq = { ...state.dlq, queue_state: 'not_configured' };
    try {
      const html = dlqMarkup('fr-CA', 'deferred-send');
      expect(html).toContain(copy('retryUnavailableNoQueue'));
      // Not a disabled control: there is nothing to put back, and a greyed-out
      // button sends the reader hunting for the reason.
      expect(html).not.toContain(copy('retryButton'));
    } finally {
      state.dlq = { ...state.dlq, queue_state: was };
    }
  });
});
