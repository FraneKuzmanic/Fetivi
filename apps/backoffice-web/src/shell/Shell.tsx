import { Wordmark } from '@fetivi/ui';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { admin, type Me } from '../api';
import { useSession } from '../session';
import { useAction } from '../useAction';

export function Shell({ me, children }: { me: Me; children: ReactNode }) {
  const { setMe, logout } = useSession();
  const { busy, error, run } = useAction();
  const isAdmin = me.account.role === 'admin';

  return (
    <>
      <Wordmark subtitle="Back office" />
      <nav className="bar">
        <span>{me.account.email}</span>
        {isAdmin && !me.actingAs ? <Link to="/admin/audit">Audit</Link> : null}
        {isAdmin && !me.actingAs ? <Link to="/">Hosts</Link> : null}
        <button type="button" className="link" onClick={() => void run(logout)}>
          Log out
        </button>
      </nav>
      {me.actingAs ? (
        <div className="banner" role="status">
          <span>Acting as {me.actingAs.email}</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(async () => setMe(await admin.stopActing()))}
          >
            Stop
          </button>
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <main>{children}</main>
    </>
  );
}
