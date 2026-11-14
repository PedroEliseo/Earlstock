import { useEffect } from 'react';

/** Sets the document title for the current page ("<title> · EarlStock"). */
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} · EarlStock` : 'EarlStock';
  }, [title]);
}
