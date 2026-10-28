import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation } from 'react-router';
import type { Me } from '../api';
import { useSession } from '../session';

export function RequireSession({ children }: { children: (me: Me) => ReactNode }) {
  const { me } = useSession();
  const { t } = useTranslation();
  const location = useLocation();
  if (me === 'loading') return <p>{t('loading')}</p>;
  // The login returns here, so an email link still opens its page after signing in.
  if (!me) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children(me)}</>;
}
