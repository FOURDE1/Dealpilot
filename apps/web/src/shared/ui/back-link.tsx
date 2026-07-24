import type { ReactNode } from 'react';
import { Link } from 'react-router';

/** Consistent back-navigation link with the <1024px touch-target floor. */
export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="text-sm font-medium text-primary hover:underline max-lg:inline-flex max-lg:min-h-11 max-lg:items-center"
    >
      ← {children}
    </Link>
  );
}
