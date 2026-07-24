import type { InputHTMLAttributes, LabelHTMLAttributes, SelectHTMLAttributes } from 'react';
import { cn } from '../lib/cn.js';

/**
 * Form field primitives on semantic tokens (D-024): --input is the field
 * BORDER, --input-bg the fill. The full react-hook-form Form composition is
 * H-05; these are the visual primitives it will build on.
 */

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('block text-[13px] font-medium', className)} {...props} />;
}

const fieldClasses =
  'h-10 w-full rounded-md border border-input bg-input-bg px-3 text-sm text-foreground ' +
  'outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 max-lg:min-h-11';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldClasses, className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative block">
      <select className={cn(fieldClasses, 'appearance-none pe-8', className)} {...props}>
        {children}
      </select>
      {/* appearance-none strips the native arrow — restore an indicator that
          inherits currentColor in both themes. */}
      <span aria-hidden="true" className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-xs">
        ▾
      </span>
    </span>
  );
}
