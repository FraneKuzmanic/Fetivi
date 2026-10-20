import { type ReactNode, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { NoLinkPage } from '../access/NoLinkPage';
import { setLanguage } from '../i18n';
import { guardDecision, useSpace } from '../space';

/**
 * Renders its children only for a device with a space; never tab content without one. Inside,
 * the interface speaks the space's language (a unit link keeps its own choice instead).
 */
export function RequireSpace({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { state } = useSpace();
  const decision = guardDecision(state);
  const language = state.status === 'ready' ? state.space.language : null;
  useEffect(() => {
    if (language) setLanguage(language);
  }, [language]);
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
  if (decision === 'offline') return <NoLinkPage reason="offline" />;
  return children;
}
