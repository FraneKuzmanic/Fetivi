import { EmptyTab, type Tab } from './EmptyTab';
import { LanguageMenu } from './LanguageMenu';
import { TabBar } from './TabBar';

/** Header, the tab's content, then the tab bar: DOM order matches top-to-bottom. */
export function Shell({ tab, unread = 0 }: { tab: Tab; unread?: number }) {
  return (
    <div className="shell">
      <header className="shell-header">
        <div className="shell-header-inner">
          <span className="shell-brand">Fetivi</span>
          <LanguageMenu />
        </div>
      </header>
      <main id="main" className="shell-main">
        <EmptyTab tab={tab} />
      </main>
      <TabBar unread={unread} />
    </div>
  );
}
