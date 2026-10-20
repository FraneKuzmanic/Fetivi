import {
  Buildings,
  ClipboardText,
  type Icon,
  SealCheck,
  SignOut,
  UsersThree,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { admin, type Me } from '../api';
import { useSession } from '../session';
import { useAction } from '../useAction';

interface NavItem {
  to: string;
  label: string;
  icon: Icon;
  /** Paths, besides `to` itself, under which the item is the current one. */
  prefixes: string[];
}

function navItems(me: Me): NavItem[] {
  if (me.account.role === 'admin' && !me.actingAs) {
    return [
      { to: '/', label: 'Hosts', icon: UsersThree, prefixes: [] },
      { to: '/admin/approvals', label: 'Approvals', icon: SealCheck, prefixes: [] },
      { to: '/admin/audit', label: 'Audit', icon: ClipboardText, prefixes: [] },
    ];
  }
  return [{ to: '/', label: 'Properties', icon: Buildings, prefixes: ['/properties', '/units'] }];
}

function Brand() {
  return (
    <Link to="/" className="brand">
      <span className="brand-name">Fetivi</span>
      <span className="brand-sub">Back office</span>
    </Link>
  );
}

export function Shell({ me, children }: { me: Me; children: ReactNode }) {
  const { setMe, logout } = useSession();
  const { busy, error, run } = useAction();
  const { pathname } = useLocation();
  const items = navItems(me);

  const isCurrent = (item: NavItem) =>
    pathname === item.to || item.prefixes.some((p) => pathname.startsWith(p));

  const links = (className: string) =>
    items.map((item) => (
      <Link
        key={item.to}
        to={item.to}
        className={className}
        aria-current={isCurrent(item) ? 'page' : undefined}
      >
        <item.icon aria-hidden="true" weight={isCurrent(item) ? 'fill' : 'regular'} />
        <span>{item.label}</span>
      </Link>
    ));

  const logOut = (
    <button type="button" className="ghost" onClick={() => void run(logout)}>
      <SignOut aria-hidden="true" />
      <span>Log out</span>
    </button>
  );

  return (
    <div className="app">
      <aside className="sidebar">
        <Brand />
        <nav className="side-nav" aria-label="Main">
          {links('side-link')}
        </nav>
        <div className="side-account">
          <span className="account-email">{me.account.email}</span>
          {logOut}
        </div>
      </aside>

      <header className="topbar">
        <Brand />
        {logOut}
      </header>

      <div className="content">
        {me.actingAs ? (
          <div className="banner" role="status">
            <span>
              Acting as <strong>{me.actingAs.email}</strong>. Every change is logged.
            </span>
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
      </div>

      <nav className="bottom-nav" aria-label="Main">
        {links('bottom-link')}
      </nav>
    </div>
  );
}
