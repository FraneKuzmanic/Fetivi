import { BookOpenText, ChatCircleDots, type Icon, Suitcase } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';
import type { Tab } from './EmptyTab';

const TABS: { tab: Tab; to: string; icon: Icon }[] = [
  { tab: 'chat', to: '/chat', icon: ChatCircleDots },
  { tab: 'guide', to: '/guide', icon: BookOpenText },
  { tab: 'trip', to: '/trip', icon: Suitcase },
];

/** Unread count on the Chat tab; renders nothing at 0. */
export function Badge({ count }: { count: number }) {
  const { t } = useTranslation();
  if (count <= 0) return null;
  return (
    <>
      <span className="badge" aria-hidden="true">
        {count > 99 ? '99+' : count}
      </span>
      <span className="visually-hidden">{t('tabs.unread', { count })}</span>
    </>
  );
}

export function TabBar({ unread = 0 }: { unread?: number }) {
  const { t } = useTranslation();
  return (
    <nav className="tabbar" aria-label={t('tabs.label')}>
      <ul>
        {TABS.map(({ tab, to, icon: TabIcon }) => (
          <li key={tab}>
            <NavLink to={to} className="tab">
              {({ isActive }) => (
                <>
                  <span className="tab-icon">
                    <TabIcon aria-hidden="true" weight={isActive ? 'fill' : 'regular'} />
                    {tab === 'chat' && <Badge count={unread} />}
                  </span>
                  <span>{t(`tabs.${tab}`)}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
