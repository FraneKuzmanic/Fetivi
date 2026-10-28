import { type ReactNode, useState } from 'react';
import { PageTitleContext } from './PageTitle';

/** For tests that mount a page without the Shell: the title the page reports, as its `<h1>`. */
export function WithPageTitle({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<string | null>(null);
  return (
    <PageTitleContext.Provider value={setTitle}>
      {title ? <h1>{title}</h1> : null}
      {children}
    </PageTitleContext.Provider>
  );
}
