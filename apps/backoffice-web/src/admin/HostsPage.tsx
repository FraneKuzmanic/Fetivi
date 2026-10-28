import { DotsThree, Pause, Play, Trash, UserSwitch, UsersThree } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { admin, type HostSummary } from '../api';
import { formatDay } from '../forms/datetime';
import { i18next } from '../i18n';
import { useSession } from '../session';
import { useConfirm } from '../shell/ConfirmDialog';
import { EmptyState } from '../shell/EmptyState';
import { Menu } from '../shell/Menu';
import { usePageTitle } from '../shell/PageTitle';
import { SearchBox } from '../shell/SearchBox';
import { useAction } from '../useAction';

/** A host's state in a word: suspension wins over a missing email check. */
export function hostStatus(h: HostSummary): [string, 'ok' | 'wait' | 'fail'] {
  if (h.suspended) return [i18next.t('admin:hosts.suspended'), 'fail'];
  if (!h.emailVerified) return [i18next.t('admin:hosts.emailNotConfirmed'), 'wait'];
  return [i18next.t('admin:hosts.active'), 'ok'];
}

/**
 * /admin/hosts: every host account; acting as one and the rarer account actions sit under each
 * row's ⋯.
 */
export function HostsPage() {
  const { t } = useTranslation(['admin', 'common', 'host']);
  const { setMe } = useSession();
  const confirm = useConfirm();
  const { error, run } = useAction();
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
      title: t('hosts.deleteTitle', { email: host.email }),
      body: t('hosts.deleteBody', { count: host.propertyCount }),
      action: t('hosts.deleteHost'),
      danger: true,
    });
    if (yes) act(() => admin.remove(host.id));
  }

  async function suspend(host: HostSummary) {
    const yes = await confirm({
      title: t('hosts.suspendTitle', { email: host.email }),
      body: t('hosts.suspendBody'),
      action: t('hosts.suspendHost'),
    });
    if (yes) act(() => admin.suspend(host.id));
  }

  const needle = query.trim().toLowerCase();
  const shown = hosts?.filter((h) => h.email.toLowerCase().includes(needle)) ?? [];

  usePageTitle(t('hosts.title'));

  return (
    <>
      {error ? <p role="alert">{error}</p> : null}
      {hosts === null && !error ? <p className="muted">{t('common:loading')}</p> : null}
      {hosts?.length === 0 ? (
        <EmptyState icon={UsersThree} title={t('hosts.none')}>
          {t('hosts.noneBody')}
        </EmptyState>
      ) : null}
      {hosts && hosts.length > 0 ? (
        <>
          <div className="toolbar">
            <SearchBox
              label={t('hosts.search')}
              value={query}
              placeholder={t('hosts.searchPlaceholder')}
              onChange={setQuery}
            />
            <span className="toolbar-note">{t('hosts.count', { count: hosts.length })}</span>
          </div>
          {shown.length === 0 ? (
            <EmptyState
              icon={UsersThree}
              title={t('hosts.noMatch', { query: query.trim() })}
              action={
                <button type="button" onClick={() => setQuery('')}>
                  {t('common:table.clearSearch')}
                </button>
              }
            />
          ) : (
            <div className="table-frame">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">{t('hosts.host')}</th>
                    <th scope="col">{t('hosts.status')}</th>
                    <th scope="col" className="num wide-only">
                      {t('hosts.propertiesColumn')}
                    </th>
                    <th scope="col" className="wide-only">
                      {t('hosts.joined')}
                    </th>
                    <th scope="col">
                      <span className="visually-hidden">{t('common:table.actions')}</span>
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
                            <Menu
                              label={t('hosts.moreFor', { email: host.email })}
                              trigger={<DotsThree aria-hidden="true" weight="bold" />}
                              items={[
                                // A suspended host cannot be acted as.
                                ...(host.suspended
                                  ? []
                                  : [
                                      {
                                        label: t('hosts.actAs'),
                                        icon: <UserSwitch aria-hidden="true" />,
                                        onSelect: () =>
                                          void run(async () => setMe(await admin.actAs(host.id))),
                                      },
                                    ]),
                                host.suspended
                                  ? {
                                      label: t('hosts.lift'),
                                      icon: <Play aria-hidden="true" />,
                                      onSelect: () => act(() => admin.unsuspend(host.id)),
                                    }
                                  : {
                                      label: t('hosts.suspend'),
                                      icon: <Pause aria-hidden="true" />,
                                      onSelect: () => void suspend(host),
                                    },
                                {
                                  label: t('common:delete'),
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
