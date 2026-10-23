import {
  Buildings,
  CalendarCheck,
  ClipboardText,
  GearSix,
  Handshake,
  type Icon,
  MapTrifold,
  Scales,
  SealCheck,
  SignOut,
  Tray,
  UsersThree,
} from '@phosphor-icons/react';
import { type ReactNode, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { admin, host, type Me } from '../api';
import { onInboxChanged, onPushMessage } from '../host/inbox/inbox-events';
import { useSession } from '../session';
import { useAction } from '../useAction';

interface NavItem {
  to: string;
  label: string;
  icon: Icon;
  /** Paths, besides `to` itself, under which the item is the current one. */
  prefixes: string[];
  /** A count shown on the item, such as unread messages. */
  badge?: number;
}

const isHostView = (me: Me) => me.account.role !== 'admin' || me.actingAs !== null;

function navItems(me: Me, unread: number): NavItem[] {
  if (!isHostView(me)) {
    return [
      { to: '/', label: 'Hosts', icon: UsersThree, prefixes: [] },
      { to: '/admin/approvals', label: 'Approvals', icon: SealCheck, prefixes: [] },
      { to: '/admin/catalog', label: 'Catalog', icon: MapTrifold, prefixes: ['/admin/catalog'] },
      {
        to: '/admin/providers',
        label: 'Providers',
        icon: Handshake,
        prefixes: ['/admin/providers', '/admin/offers'],
      },
      { to: '/admin/reconciliation', label: 'Reconciliation', icon: Scales, prefixes: [] },
      { to: '/admin/audit', label: 'Audit', icon: ClipboardText, prefixes: [] },
    ];
  }
  return [
    { to: '/', label: 'Properties', icon: Buildings, prefixes: ['/properties', '/units'] },
    { to: '/stays', label: 'Stays', icon: CalendarCheck, prefixes: ['/stays'] },
    { to: '/inbox', label: 'Inbox', icon: Tray, prefixes: ['/inbox'], badge: unread },
    { to: '/settings/notifications', label: 'Settings', icon: GearSix, prefixes: ['/settings'] },
  ];
}

function Brand() {
  return (
    <Link to="/" className="brand">
      <span className="brand-name">Fetivi</span>
      <span className="brand-sub">Back office</span>
    </Link>
  );
}

const UNREAD_POLL_MS = 60_000;

export function Shell({ me, children }: { me: Me; children: ReactNode }) {
  const { setMe, logout } = useSession();
  const { busy, error, run } = useAction();
  const { pathname } = useLocation();
  const [unread, setUnread] = useState(0);
  const hostView = isHostView(me);
  const items = navItems(me, unread);

  // The unread count, checked on every page change, every minute and on a push to this phone.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a page change is the trigger.
  useEffect(() => {
    if (!hostView) return;
    let live = true;
    const check = () =>
      host.inbox().then(
        ({ unread: n }) => live && setUnread(n),
        () => {},
      );
    void check();
    const stop = onInboxChanged(() => void check());
    const stopPush = onPushMessage(() => void check());
    const timer = setInterval(() => void check(), UNREAD_POLL_MS);
    return () => {
      live = false;
      stop();
      stopPush();
      clearInterval(timer);
    };
  }, [hostView, pathname]);

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
        {item.badge ? (
          <span className="nav-badge" role="img" aria-label={`${item.badge} unread`}>
            {item.badge > 99 ? '99+' : item.badge}
          </span>
        ) : null}
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
