import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Label } from '@dealpilot/ui';
import { JOB_QUEUES, type QueueNameT } from '@dealpilot/contracts';
import type { AdminRetryResultT, RetryJobsInputT } from '@dealpilot/schemas';
import { RETRY_OUTCOME_KEYS } from './labels.js';
import { useRetryDlqJobs } from './api.js';

/**
 * F-73 §9 — putting failed jobs back on the queue (admin-console.md §9, D-074).
 *
 * THE WARNING IS TEXT, NOT A COLOUR, and it is not a generic "are you sure".
 * On `deferred-send`, `assistant-turn`, `first-touch` and `drip-tick` a retry
 * can put a SECOND text message in front of a real dealer customer: those
 * workers stamp the carrier reference only AFTER the carrier answers, so a
 * timeout leaves the message delivered with no reference — which is one of the
 * likeliest reasons the job is in the failed set — and re-running it sends the
 * text again. Nothing on that path detects the duplicate. The person clicking
 * has to be told that in a sentence they can read, in their own language, on a
 * greyscale screen and through a screen reader alike.
 *
 * WHICH QUEUES need the typed-back name is not a list kept here: it is
 * `JOB_QUEUES[queue].replay`, derived once and machine-checked by
 * `apps/workers/src/queue-replay.test.ts` against the worker file that would
 * have to make an `idempotent` claim true. The server refuses a mismatch with
 * 422 `key_mismatch` whatever this form does, so the two cannot drift apart —
 * this half exists so the refusal is not how the operator learns.
 *
 * The form is exported apart from the dialog because the dialog is a PORTAL:
 * `renderToStaticMarkup` renders nothing inside one, and the copy above is
 * exactly the copy that must be proven to reach a screen.
 */

const TEXTAREA_CLASSES =
  'w-full rounded-md border border-input bg-input-bg px-3 py-2 text-sm text-foreground ' +
  'outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

export function RetryJobsForm({
  queue,
  jobIds,
  pending = false,
  failed = false,
  outcomes = null,
  onSubmit,
  onCancel,
}: {
  queue: QueueNameT;
  jobIds: readonly string[];
  pending?: boolean;
  failed?: boolean;
  outcomes?: AdminRetryResultT | null;
  onSubmit: (input: RetryJobsInputT) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('jobs');
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);

  // Derived, never declared here. A second copy of this list is a second thing
  // that can be wrong about which queue can text a customer twice.
  const duplicates = JOB_QUEUES[queue].replay === 'at_least_once';
  const reasonShort = reason.trim().length < 10;
  const confirmMismatch = duplicates && confirm.trim() !== queue;

  // The results panel takes focus when it appears (below): the button that had
  // it is unmounted by the same render, and dropped focus on the one screen
  // where "was a customer texted?" is the question is how the operator re-presses.
  const resultRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (outcomes) requestAnimationFrame(() => resultRef.current?.focus());
  }, [outcomes]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (reasonShort || confirmMismatch || jobIds.length === 0) {
      // A refusal that neither speaks nor moves is indistinguishable from a
      // request that was accepted (WCAG 2.2 SC 3.3.1). The hints below become
      // `role="alert"` paragraphs with words of their own, and focus goes to
      // the field that refused — the same discipline as the F-71 dialog.
      const offender = reasonShort ? 'retry-reason' : confirmMismatch ? 'retry-confirm' : null;
      if (offender !== null) document.getElementById(offender)?.focus();
      return;
    }
    onSubmit({
      job_ids: [...jobIds],
      reason: reason.trim(),
      ...(duplicates ? { confirm_queue_name: confirm.trim() } : {}),
    });
  };

  // Once the request has answered, the form is done asking and starts
  // reporting: re-offering the button beside a list of outcomes is how the
  // same twenty ids get sent twice.
  if (outcomes) {
    return (
      // A status region, not an alert: the request succeeded. It is focused on
      // arrival because a freshly inserted live region is not reliably spoken,
      // and this is the only signal that up to twenty customers may have just
      // been texted.
      <div ref={resultRef} tabIndex={-1} role="status" className="space-y-3 outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <h3 className="text-sm font-semibold">{t('retryOutcomesTitle')}</h3>
        <ul className="space-y-1">
          {outcomes.outcomes.map((o) => (
            <li key={o.job_id} className="flex flex-wrap gap-2 text-sm">
              <span className="font-mono text-xs">{o.job_id}</span>
              {/* The word IS the signal. Nothing here is distinguished by
                  colour alone, because "not attempted" and "put back" are the
                  difference between a customer who was texted and one who was
                  not. */}
              <span>{t(RETRY_OUTCOME_KEYS[o.retry_outcome])}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">{t('outcomesHelp')}</p>
        {/* Not "Cancel": the jobs are already back on the queue and nothing
            here can be undone. A dismiss button that reads as an undo beside a
            list saying "put back on the queue" is a promise the product cannot
            keep. */}
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          {t('retryDone')}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('retrySelected', { count: jobIds.length })}</p>
      {/* The ids, not just a count: a tally is not something an operator can
          check, and the selection was made against a list that may since have
          been filtered to a different tenant. */}
      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {jobIds.map((id) => (
          <li key={id} className="font-mono text-xs text-muted-foreground">{id}</li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{t('retryMax')}</p>

      {/* Permanent for as long as the queue is what it is — not an error, not
          a transient state, so a status region rather than an alert. */}
      <p role="status" className={duplicates ? 'text-sm font-medium text-danger-text' : 'text-sm text-muted-foreground'}>
        {duplicates ? t('retryDuplicateWarning') : t('retryReplaySafe')}
      </p>

      <div className="space-y-1">
        <Label htmlFor="retry-reason">{t('retryReason')}</Label>
        <textarea
          id="retry-reason"
          required
          maxLength={500}
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-invalid={touched && reasonShort ? true : undefined}
          aria-describedby={touched && reasonShort ? 'retry-reason-error retry-reason-hint' : 'retry-reason-hint'}
          className={TEXTAREA_CLASSES}
        />
        {/* The WORDS carry the state. Re-tinting one unchanged sentence is
            invisible in greyscale, to a red-green-deficient reader and in
            forced colours, and silent to a screen reader (WCAG 2.2 SC 1.4.1);
            no stylesheet in the repo reacts to `aria-invalid` either. */}
        {touched && reasonShort ? (
          <p id="retry-reason-error" role="alert" className="text-xs font-medium text-danger-text">
            {t('retryReasonTooShort')}
          </p>
        ) : null}
        <p id="retry-reason-hint" className="text-xs text-muted-foreground">
          {t('retryReasonHint')}
        </p>
      </div>

      {duplicates ? (
        <div className="space-y-1">
          <Label htmlFor="retry-confirm">{t('retryConfirmLabel', { queue })}</Label>
          <Input
            id="retry-confirm"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-invalid={touched && confirmMismatch ? true : undefined}
            aria-describedby={touched && confirmMismatch ? 'retry-confirm-error retry-confirm-hint' : 'retry-confirm-hint'}
            className="font-mono text-[12px]"
          />
          {/* Its own alert rather than a swapped word inside the hint: swapping
              the text of a node the reader is not focused on announces
              nothing, and the refusal is what they pressed the button to hear. */}
          {touched && confirmMismatch ? (
            <p id="retry-confirm-error" role="alert" className="text-xs font-medium text-danger-text">
              {t('retryConfirmMismatch')}
            </p>
          ) : null}
          <p id="retry-confirm-hint" className="text-xs text-muted-foreground">
            {t('retryConfirmHint')}
          </p>
        </div>
      ) : null}

      {failed ? (
        <p role="alert" className="text-sm text-danger-text">
          {t('retryError')}
        </p>
      ) : null}

      <div className="flex gap-2">
        {/* Reachable even while invalid: a disabled button announces nothing.
            Pressing it while invalid renders the refusal as an alert and moves
            focus to the field that refused, so the refusals above really are
            what the person hears. */}
        <Button type="submit" size="sm" disabled={pending}>
          {t('retrySubmit')}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          {t('retryCancel')}
        </Button>
      </div>
    </form>
  );
}

/** The form in a modal, with the mutation wired. Closed by `queue === null`. */
export function RetryJobsDialog({
  queue,
  jobIds,
  organizationId,
  onClose,
}: {
  queue: QueueNameT;
  jobIds: readonly string[];
  organizationId: string | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation('jobs');
  // The caller mounts this only while it is open, so the mutation is born and
  // dies with the dialog and no reset is needed. `queue` is non-null for the
  // same reason — there is no shut state to keep a placeholder honest.
  const retry = useRetryDlqJobs(queue, organizationId);

  return (
    <Dialog.Root
      open
      onOpenChange={(open: boolean) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogTitle>{t('retryTitle')}</DialogTitle>
        <DialogDescription>{t('dlqTitle', { queue: t(`queue_${queue}`) })}</DialogDescription>
        <RetryJobsForm
          queue={queue}
          jobIds={jobIds}
          pending={retry.isPending}
          failed={retry.isError}
          outcomes={retry.data ?? null}
          onSubmit={(input) => retry.mutate(input)}
          onCancel={onClose}
        />
      </DialogContent>
    </Dialog.Root>
  );
}
