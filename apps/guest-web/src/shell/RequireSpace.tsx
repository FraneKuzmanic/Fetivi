import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NoLinkPage } from '../access/NoLinkPage';
import { guardDecision, useSpace } from '../space';

/** Renders its children only for a device with a space; never tab content without one. */
export function RequireSpace({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { state } = useSpace();
  const decision = guardDecision(state);
  if (decision === 'loading') {
    return (
      <main className="access">
        <p className="status" role="status">
          {t('common.loading')}
        </p>
      </main>
    );
  }
  if (decision === 'no-link') return <NoLinkPage />;
  return children;
}
