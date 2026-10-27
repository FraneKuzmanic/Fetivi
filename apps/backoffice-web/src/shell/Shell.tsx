import { Mascot } from '@fetivi/ui';
import {
  Buildings,
  CalendarCheck,
  CaretDown,
  ClipboardText,
  DotsThreeOutline,
  GearSix,
  Handshake,
  House,
  type Icon,
  Lightbulb,
  ListChecks,
  MapTrifold,
  Receipt,
  Scales,
  SealCheck,
  SidebarSimple,
  SignOut,
  Storefront,
  ThumbsUp,
  Tray,
  UsersThree,
} from '@phosphor-icons/react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { admin, host, type Me } from '../api';
import { onInboxChanged, onPushMessage } from '../host/inbox/inbox-events';
import { useSession } from '../session';
import { useAction } from '../useAction';
import { Menu } from './Menu';

interface NavItem {
  to: string;
  label: string;
  /** The phone bottom nav's label, when `label` does not fit a sixth of a phone's width. */
  short?: string;
  icon: Icon;
  /** Paths, besides `to` itself, under which the item is the current one. */
  prefixes: string[];
  /** A count shown on the item, such as unread messages. */
  badge?: number;
  /** A queue that is fine to have waiting: its count is blue, not red. */
  calm?: boolean;
  /** Kept apart at the bottom of the sidebar. */
  foot?: boolean;
  /** Admin items are grouped in the sidebar: the daily queues, what the admin keeps, the logs. */
  group?: 'work' | 'manage' | 'insight';
  /** An admin item that keeps its own place in the phone's bottom bar; the rest go under More. */
  phone?: boolean;
}

const isHostView = (me: Me) => me.account.role !== 'admin' || me.actingAs !== null;

/** What waits on the admin, shown as counts on the nav items. */
export interface AdminCounts {
  approvals: number;
  curation: number;
  orders: number;
  payments: number;
}

function navItems(me: Me, unread: number, counts: AdminCounts | null): NavItem[] {
  if (!isHostView(me)) {
    return [
      { to: '/', label: 'Today', icon: House, prefixes: [], group: 'work', phone: true },
      {
        to: '/admin/approvals',
        label: 'Approvals',
        icon: SealCheck,
        prefixes: [],
        badge: counts?.approvals,
        calm: true,
        group: 'work',
        phone: true,
      },
      {
        to: '/admin/curation',
        label: 'Curation',
        icon: ListChecks,
        prefixes: ['/admin/curation'],
        badge: counts?.curation,
        calm: true,
        group: 'work',
        phone: true,
      },
      {
        to: '/admin/orders',
        label: 'Orders',
        icon: Receipt,
        prefixes: ['/admin/orders'],
        badge: counts?.orders,
        group: 'work',
        phone: true,
      },
      {
        to: '/admin/reconciliation',
        label: 'Payment checks',
        icon: Scales,
        prefixes: [],
        badge: counts?.payments,
        group: 'work',
      },
      {
        to: '/admin/catalog',
        label: 'Catalog',
        icon: MapTrifold,
        prefixes: ['/admin/catalog'],
        group: 'manage',
      },
      {
        to: '/admin/providers',
        label: 'Providers',
        icon: Handshake,
        prefixes: ['/admin/providers', '/admin/offers'],
        group: 'manage',
      },
      { to: '/admin/hosts', label: 'Hosts', icon: UsersThree, prefixes: [], group: 'manage' },
      { to: '/admin/feedback', label: 'Feedback', icon: ThumbsUp, prefixes: [], group: 'insight' },
      {
        to: '/admin/audit',
        label: 'Audit log',
        icon: ClipboardText,
        prefixes: [],
        group: 'insight',
      },
      { to: '/admin/settings', label: 'Settings', icon: GearSix, prefixes: [], foot: true },
    ];
  }
  return [
    { to: '/', label: 'Today', icon: House, prefixes: [] },
    {
      to: '/properties',
      label: 'Properties',
      icon: Buildings,
      prefixes: ['/properties', '/units'],
    },
    { to: '/stays', label: 'Stays', icon: CalendarCheck, prefixes: ['/stays'] },
    { to: '/services', label: 'Services', icon: Storefront, prefixes: ['/services'] },
    { to: '/inbox', label: 'Inbox', icon: Tray, prefixes: ['/inbox'], badge: unread },
    {
      to: '/suggestions',
      label: 'Suggestions',
      short: 'To add',
      icon: Lightbulb,
      prefixes: ['/suggestions'],
    },
    { to: '/settings', label: 'Settings', icon: GearSix, prefixes: ['/settings'], foot: true },
  ];
}

function Brand() {
  return (
    <Link to="/" className="brand" aria-label="Fetivi, home">
      <Mascot className="brand-mascot" />
      <span className="brand-name">Fetivi</span>
    </Link>
  );
}

const UNREAD_POLL_MS = 60_000;
const WIDE = '(min-width: 900px)';
/** How long the sidebar takes to fold; matches the grid transition in styles.css. */
const FOLD_MS = 240;
const COLLAPSED_KEY = 'fetivi.sidebar-collapsed';

function storedCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function storeCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    // Blocked storage: the choice lasts until the page reloads.
  }
}

/** Whether the sidebar is showing (a wide screen), following the window as it resizes. */
function useWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia?.(WIDE).matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.(WIDE);
    if (!query) return;
    const change = () => setWide(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  return wide;
}

/** The signed-in person's initial, for the profile button. */
const initialOf = (email: string) => (email.trim()[0] ?? '?').toUpperCase();

export function Shell({ me, children }: { me: Me; children: ReactNode }) {
  const { setMe, logout } = useSession();
  const { busy, error, run } = useAction();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [unread, setUnread] = useState(0);
  const [counts, setCounts] = useState<AdminCounts | null>(null);
  const [collapsed, setCollapsed] = useState(storedCollapsed);
  const wide = useWide();
  const [folding, setFolding] = useState(false);
  const foldTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(foldTimer.current), []);
  const hostView = isHostView(me);
  const items = navItems(me, unread, counts);
  // Setup has its own sticky footer; the phone's bottom nav would squeeze the form between them.
  const focused = /^\/units\/[^/]+\/setup(\/|$)/.test(pathname);

  // The unread count, checked on every page change, every minute and on a push to this phone.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a page change is the trigger.
  useEffect(() => {
    if (!hostView) return;
    let live = true;
    const check = () =>
      host.inbox().then(
        // Unread messages plus own-service Orders waiting for an answer (38).
        ({ unread: n, ordersWaiting }) => live && setUnread(n + ordersWaiting),
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

  // What waits on the admin, checked on every page change and every minute.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a page change is the trigger.
  useEffect(() => {
    if (hostView) return;
    let live = true;
    const check = () =>
      admin.overview().then(
        (o) =>
          live &&
          setCounts({
            approvals: o.approvalsPending,
            curation: o.curationOpen,
            orders: o.ordersNeedAction,
            payments: o.paymentProblems,
          }),
        () => {},
      );
    void check();
    const timer = setInterval(() => void check(), UNREAD_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [hostView, pathname]);

  const isCurrent = (item: NavItem) =>
    item.to === '/'
      ? pathname === '/'
      : pathname === item.to || item.prefixes.some((p) => pathname.startsWith(p));

  const links = (list: NavItem[], className: string, short = false) =>
    // On a phone a host reaches Settings from the profile menu, leaving room for six items.
    list
      .filter((item) => !(short && item.to === '/settings'))
      .map((item, i, all) => (
        <Link
          key={item.to}
          to={item.to}
          className={
            // A line between the admin's groups: queues, what the admin keeps, the logs.
            !short && i > 0 && item.group !== all[i - 1]?.group
              ? `${className} group-start`
              : className
          }
          aria-current={isCurrent(item) ? 'page' : undefined}
          title={collapsed && !short ? item.label : undefined}
        >
          <item.icon aria-hidden="true" weight={isCurrent(item) ? 'fill' : 'regular'} />
          <span className="nav-label">{(short && item.short) || item.label}</span>
          {item.badge ? (
            <span
              className={item.calm ? 'nav-badge calm' : 'nav-badge'}
              role="img"
              aria-label={`${item.badge} waiting`}
            >
              {item.badge > 99 ? '99+' : item.badge}
            </span>
          ) : null}
        </Link>
      ));

  const toggle = () => {
    setCollapsed(!collapsed);
    storeCollapsed(!collapsed);
    // While the width slides, the toggle is hidden so it never passes over the mascot.
    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setFolding(true);
      clearTimeout(foldTimer.current);
      foldTimer.current = setTimeout(() => setFolding(false), FOLD_MS);
    }
  };

  const menuItems = [
    // The sidebar has Settings at its foot; a host's phone has it only here.
    ...(hostView && !wide
      ? [
          {
            label: 'Settings',
            icon: <GearSix aria-hidden="true" />,
            onSelect: () => navigate('/settings'),
          },
        ]
      : []),
    {
      label: 'Log out',
      icon: <SignOut aria-hidden="true" />,
      onSelect: () => void run(logout),
    },
  ];

  const profile = (
    <Menu
      label="Account"
      className="profile-button"
      trigger={
        <>
          <span className="avatar" aria-hidden="true">
            {initialOf(me.account.email)}
          </span>
          <CaretDown aria-hidden="true" className="profile-caret" />
        </>
      }
      header={
        <>
          <span className="menu-caption">Signed in as</span>
          <strong className="menu-email">{me.account.email}</strong>
        </>
      }
      items={menuItems}
    />
  );

  const appClass = [
    'app',
    collapsed ? 'collapsed' : '',
    folding ? 'folding' : '',
    focused ? 'focused' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={appClass}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <div className="sidebar-head">
          <Brand />
          <button
            type="button"
            className="ghost icon-button sidebar-toggle"
            aria-label={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
            title={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
            aria-expanded={!collapsed}
            aria-controls="side-nav"
            onClick={toggle}
          >
            <SidebarSimple aria-hidden="true" />
          </button>
        </div>
        <nav id="side-nav" className="side-nav" aria-label="Main">
          {links(
            items.filter((item) => !item.foot),
            'side-link',
          )}
          <div className="side-foot">
            {links(
              items.filter((item) => item.foot),
              'side-link',
            )}
          </div>
        </nav>
      </aside>

      <div className="main-col">
        {me.actingAs ? (
          <div className="acting">
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
          </div>
        ) : null}

        <header className="topbar">
          <Brand />
          {profile}
        </header>

        <div className="content">
          {error ? <p role="alert">{error}</p> : null}
          <main id="main" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>

      <nav className="bottom-nav" aria-label="Main">
        {hostView ? (
          links(items, 'bottom-link', true)
        ) : (
          <>
            {links(
              items.filter((item) => item.phone),
              'bottom-link',
              true,
            )}
            <MoreMenu
              items={items.filter((item) => !item.phone)}
              current={items.some((item) => !item.phone && isCurrent(item))}
            />
          </>
        )}
      </nav>
    </div>
  );
}

/** The admin's phone bar has room for four items; the rest open from More. */
function MoreMenu({ items, current }: { items: NavItem[]; current: boolean }) {
  const navigate = useNavigate();
  const waiting = items.reduce((n, item) => n + (item.badge ?? 0), 0);
  const calm = items.every((item) => !item.badge || item.calm);
  return (
    <Menu
      label="More pages"
      className={current ? 'bottom-link bottom-more current' : 'bottom-link bottom-more'}
      align="end"
      up
      trigger={
        <>
          <DotsThreeOutline aria-hidden="true" weight={current ? 'fill' : 'regular'} />
          <span className="nav-label">More</span>
          {waiting ? (
            <span
              className={calm ? 'nav-badge calm' : 'nav-badge'}
              role="img"
              aria-label={`${waiting} waiting`}
            >
              {waiting > 99 ? '99+' : waiting}
            </span>
          ) : null}
        </>
      }
      items={items.map((item) => ({
        label: item.badge ? `${item.label} (${item.badge})` : item.label,
        icon: <item.icon aria-hidden="true" />,
        onSelect: () => navigate(item.to),
      }))}
    />
  );
}
