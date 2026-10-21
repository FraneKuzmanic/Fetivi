import { UserCircle } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';
import { ChatTab } from '../chat/ChatTab';
import { TripTab } from '../my-trip/TripTab';
import { EmptyTab, type Tab } from './EmptyTab';
import { LanguageMenu } from './LanguageMenu';
import { TabBar } from './TabBar';

/** Header, the tab's content (or a page such as About me), then the tab bar: DOM order matches top-to-bottom. */
export function Shell({
  tab,
  unread = 0,
  children,
}: {
  tab?: Tab;
  unread?: number;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="shell">
      <header className="shell-header">
        <div className="shell-header-inner">
          <span className="shell-brand">Fetivi</span>
          <div className="shell-header-actions">
            <NavLink to="/about-me" className="header-link">
              <UserCircle aria-hidden="true" />
              <span className="visually-hidden">{t('header.aboutMe')}</span>
            </NavLink>
            <LanguageMenu />
          </div>
        </div>
      </header>
      <main id="main" className="shell-main">
        {children ??
          (tab === 'trip' ? <TripTab /> : tab === 'guide' ? <EmptyTab tab={tab} /> : <ChatTab />)}
      </main>
      <TabBar unread={unread} />
    </div>
  );
}
