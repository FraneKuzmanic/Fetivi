import { GearSix, UserCircle } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';
import { ChatTab } from '../chat/ChatTab';
import { EmailProvider } from '../email/EmailProvider';
import { GuideTab } from '../guide/GuideTab';
import { InboxProvider, useInbox } from '../inbox/InboxProvider';
import { TripTab } from '../my-trip/TripTab';
import { PushProvider } from '../push/AlertOffer';
import { EmptyTab, type Tab } from './EmptyTab';
import { TabBar } from './TabBar';

/** Header, the tab's content (or a page such as About me), then the tab bar: DOM order matches top-to-bottom. */
export function Shell(props: { tab?: Tab; unread?: number; children?: ReactNode }) {
  return (
    <InboxProvider>
      <EmailProvider>
        <PushProvider>
          <ShellLayout {...props} />
        </PushProvider>
      </EmailProvider>
    </InboxProvider>
  );
}

/** `unread` overrides the inbox's count (tests). */
function ShellLayout({
  tab,
  unread,
  children,
}: {
  tab?: Tab;
  unread?: number;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const inbox = useInbox();
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
            <NavLink to="/settings" className="header-link">
              <GearSix aria-hidden="true" />
              <span className="visually-hidden">{t('header.settings')}</span>
            </NavLink>
          </div>
        </div>
      </header>
      <main id="main" className="shell-main">
        {children ??
          (tab === 'chat' ? (
            <ChatTab />
          ) : tab === 'guide' ? (
            <GuideTab />
          ) : tab === 'trip' ? (
            <TripTab />
          ) : (
            <EmptyTab tab={tab ?? 'chat'} />
          ))}
      </main>
      <TabBar unread={unread ?? inbox.unread} />
    </div>
  );
}
