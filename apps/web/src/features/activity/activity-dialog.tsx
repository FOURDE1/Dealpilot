import { useTranslation } from 'react-i18next';
import { Button, Dialog, DialogContent, DialogTitle } from '@dealpilot/ui';
import type { DealT } from '@dealpilot/schemas';
import { ActivityTimeline } from './activity-timeline.js';

export function DealActivityDialog({
  deal,
  dealLabel,
  onClose,
}: {
  deal: DealT | null;
  dealLabel?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation('activity');
  return (
    <Dialog.Root open={deal !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-h-[85svh] overflow-y-auto">
        <DialogTitle>
          {t('title')}
          {dealLabel ? <span className="text-muted-foreground"> — {dealLabel}</span> : null}
        </DialogTitle>
        <div className="mt-3">
          {deal ? (
            <ActivityTimeline entityType="deal" entityId={deal.id} organizationId={deal.organization_id} />
          ) : null}
        </div>
        <div className="mt-4 flex justify-end">
          <Dialog.Close
            render={
              <Button type="button" variant="outline">
                {t('close')}
              </Button>
            }
          />
        </div>
      </DialogContent>
    </Dialog.Root>
  );
}
