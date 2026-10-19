import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import type { Me } from '../api';
import { useSession } from '../session';

export function RequireSession({ children }: { children: (me: Me) => ReactNode }) {
  const { me } = useSession();
  if (me === 'loading') return <p>Loading…</p>;
  if (!me) return <Navigate to="/login" replace />;
  return <>{children(me)}</>;
}
