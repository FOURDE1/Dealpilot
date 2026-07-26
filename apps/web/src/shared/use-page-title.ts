import { useEffect } from 'react';

/** WCAG 2.4.2: every route names itself in the tab. */
export function usePageTitle(title: string | undefined): void {
  useEffect(() => {
    if (title) document.title = `${title} — 1Dealer`;
    return () => {
      document.title = '1Dealer';
    };
  }, [title]);
}
