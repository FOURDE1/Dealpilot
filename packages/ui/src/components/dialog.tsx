import type { ComponentProps, ReactNode } from 'react';
import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { cn } from '../lib/cn.js';

/**
 * Themed Base UI dialog (ADR-017). Compound API re-exported so consumers keep
 * full control; DialogContent bundles the portal/backdrop/popup with tokens.
 */
export const Dialog = {
  Root: BaseDialog.Root,
  Trigger: BaseDialog.Trigger,
  Close: BaseDialog.Close,
  Title: BaseDialog.Title,
  Description: BaseDialog.Description,
};

export function DialogContent({
  className,
  children,
  ...props
}: ComponentProps<typeof BaseDialog.Popup> & { children: ReactNode }) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-foreground/40 motion-safe:transition-opacity motion-safe:duration-fast" />
      <BaseDialog.Popup
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg',
          // Every dialog must scroll rather than clip on small viewports.
          'max-h-[85svh] overflow-y-auto',
          'border border-border bg-card p-6 text-card-foreground shadow-lg outline-none',
          className,
        )}
        {...props}
      >
        {children}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof BaseDialog.Title>) {
  return <BaseDialog.Title className={cn('text-lg font-semibold', className)} {...props} />;
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof BaseDialog.Description>) {
  return (
    <BaseDialog.Description className={cn('mt-1 text-sm text-muted-foreground', className)} {...props} />
  );
}
