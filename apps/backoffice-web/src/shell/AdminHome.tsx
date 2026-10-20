import { useCallback, useEffect, useState } from 'react';
import { admin, type HostSummary } from '../api';
import { useSession } from '../session';
import { useAction } from '../useAction';

export function AdminHome() {
  const { setMe } = useSession();
  const { busy, error, run } = useAction();
  const [hosts, setHosts] = useState<HostSummary[] | null>(null);

  const load = useCallback(() => run(async () => setHosts((await admin.hosts()).hosts)), [run]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = (action: () => Promise<void>) =>
    void run(async () => {
      await action();
      setHosts((await admin.hosts()).hosts);
    });

  return (
    <section>
      <h1>Hosts</h1>
      {error ? <p role="alert">{error}</p> : null}
      {hosts === null ? <p>Loading…</p> : null}
      {hosts?.length === 0 ? <p className="empty">No hosts yet.</p> : null}
      <ul className="list">
        {hosts?.map((host) => (
          <li key={host.id}>
            <strong>{host.email}</strong>
            <span>
              {host.emailVerified ? 'Verified' : 'Not verified'}
              {host.suspended ? ' · Suspended' : ''}
            </span>
            <div className="actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(async () => setMe(await admin.actAs(host.id)))}
              >
                Act as
              </button>
              {host.suspended ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => act(() => admin.unsuspend(host.id))}
                >
                  Unsuspend
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => act(() => admin.suspend(host.id))}
                >
                  Suspend
                </button>
              )}
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete ${host.email} and all their data? This cannot be undone.`,
                    )
                  ) {
                    act(() => admin.remove(host.id));
                  }
                }}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
