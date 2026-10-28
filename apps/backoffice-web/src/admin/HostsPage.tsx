import { DotsThree, Pause, Play, Trash, UsersThree } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import { admin, type HostSummary } from '../api';
import { formatDay } from '../forms/datetime';
import { useSession } from '../session';
import { useConfirm } from '../shell/ConfirmDialog';
import { EmptyState } from '../shell/EmptyState';
import { Menu } from '../shell/Menu';
import { usePageTitle } from '../shell/PageTitle';
import { SearchBox } from '../shell/SearchBox';
import { useAction } from '../useAction';

/** A host's state in a word: suspension wins over a missing email check. */
export function hostStatus(h: HostSummary): [string, 'ok' | 'wait' | 'fail'] {
  if (h.suspended) return ['Suspended', 'fail'];
  if (!h.emailVerified) return ['Email not confirmed', 'wait'];
  return ['Active', 'ok'];
}

const propertiesLabel = (n: number) => (n === 1 ? '1 property' : `${n} properties`);

/** /admin/hosts: every host account, with acting as one and the rarer account actions. */
export function HostsPage() {
  const { setMe } = useSession();
  const confirm = useConfirm();
  const { busy, error, run } = useAction();
  const [hosts, setHosts] = useState<HostSummary[] | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(() => run(async () => setHosts((await admin.hosts()).hosts)), [run]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = (action: () => Promise<void>) =>
    void run(async () => {
      await action();
      setHosts((await admin.hosts()).hosts);
    });

  async function remove(host: HostSummary) {
    const yes = await confirm({
      title: `Delete ${host.email}?`,
      body: `Their account and all their data go, including ${propertiesLabel(host.propertyCount)}. This cannot be undone.`,
      action: 'Delete host',
      danger: true,
    });
    if (yes) act(() => admin.remove(host.id));
  }

  async function suspend(host: HostSummary) {
    const yes = await confirm({
      title: `Suspend ${host.email}?`,
      body: 'They are logged out and cannot log in until you lift the suspension.',
      action: 'Suspend host',
    });
    if (yes) act(() => admin.suspend(host.id));
  }

  const needle = query.trim().toLowerCase();
  const shown = hosts?.filter((h) => h.email.toLowerCase().includes(needle)) ?? [];

  usePageTitle('Hosts');

  return (
    <>
      {error ? <p role="alert">{error}</p> : null}
      {hosts === null && !error ? <p className="muted">Loading…</p> : null}
      {hosts?.length === 0 ? (
        <EmptyState icon={UsersThree} title="No hosts yet">
          Hosts appear here once they sign up and confirm their email.
        </EmptyState>
      ) : null}
      {hosts && hosts.length > 0 ? (
        <>
          <div className="toolbar">
            <SearchBox
              label="Search hosts"
              value={query}
              placeholder="Search by email"
              onChange={setQuery}
            />
            <span className="toolbar-note">
              {hosts.length === 1 ? '1 host' : `${hosts.length} hosts`}
            </span>
          </div>
          {shown.length === 0 ? (
            <EmptyState
              icon={UsersThree}
              title={`No host matches “${query.trim()}”`}
              action={
                <button type="button" onClick={() => setQuery('')}>
                  Clear search
                </button>
              }
            />
          ) : (
            <div className="table-frame">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Host</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="num wide-only">
                      Properties
                    </th>
                    <th scope="col" className="wide-only">
                      Joined
                    </th>
                    <th scope="col">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((host) => {
                    const [status, tone] = hostStatus(host);
                    return (
                      <tr key={host.id}>
                        <td>
                          <strong>{host.email}</strong>
                        </td>
                        <td>
                          <span className={`chip ${tone}`}>{status}</span>
                        </td>
                        <td className="num wide-only">{host.propertyCount}</td>
                        <td className="nowrap wide-only">{formatDay(host.createdAt)}</td>
                        <td className="cell-actions">
                          <div className="actions">
                            <button
                              type="button"
                              disabled={busy || host.suspended}
                              onClick={() =>
                                void run(async () => setMe(await admin.actAs(host.id)))
                              }
                            >
                              Act as
                            </button>
                            <Menu
                              label={`More for ${host.email}`}
                              trigger={<DotsThree aria-hidden="true" weight="bold" />}
                              items={[
                                host.suspended
                                  ? {
                                      label: 'Lift suspension',
                                      icon: <Play aria-hidden="true" />,
                                      onSelect: () => act(() => admin.unsuspend(host.id)),
                                    }
                                  : {
                                      label: 'Suspend',
                                      icon: <Pause aria-hidden="true" />,
                                      onSelect: () => void suspend(host),
                                    },
                                {
                                  label: 'Delete',
                                  icon: <Trash aria-hidden="true" />,
                                  danger: true,
                                  onSelect: () => void remove(host),
                                },
                              ]}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </>
  );
}
