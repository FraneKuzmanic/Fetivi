import { createContext, useContext, useEffect } from 'react';

/** Shell's setter for the header title; a page outside the Shell sets nothing. */
export const PageTitleContext = createContext<(title: string | null) => void>(() => {});

/**
 * Shows the page's title in the header, as the page's only `<h1>`. Pass `undefined` while the
 * data loads; the header shows the current nav item's label until then.
 */
export function usePageTitle(title: string | null | undefined): void {
  const setTitle = useContext(PageTitleContext);
  useEffect(() => {
    // Nothing yet sets nothing, so a page still loading never clears a title its child set.
    if (title == null) return;
    setTitle(title);
    return () => setTitle(null);
  }, [title, setTitle]);
}
