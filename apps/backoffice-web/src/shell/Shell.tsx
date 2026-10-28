import { BACKOFFICE_LANGUAGES, type BackofficeLanguage } from '@fetivi/domain/vocabulary';
import { Mascot } from '@fetivi/ui';
import {
  Buildings,
  CalendarCheck,
  CaretDown,
  Check,
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
  Translate,
  Tray,
  UsersThree,
} from '@phosphor-icons/react';
import type { TFunction } from 'i18next';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router';
import { admin, auth, host, type Me } from '../api';
import { longDay, todayIso } from '../forms/datetime';
import { onInboxChanged, onPushMessage } from '../host/inbox/inbox-events';
import { currentLanguage, setLanguage } from '../i18n';
import { LANGUAGE_NAMES } from '../i18n/languages';
import { storeLanguage } from '../i18n/stored-language';
import { useSession } from '../session';
import { useAction } from '../useAction';
import { Menu, type MenuItem } from './Menu';
import { PageTitleContext } from './PageTitle';

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

function navItems(
  t: TFunction<'shell'>,
  me: Me,
  unread: number,
  counts: AdminCounts | null,
): NavItem[] {
  if (!isHostView(me)) {
    return [
      { to: '/', label: t('nav.today'), icon: House, prefixes: [], group: 'work', phone: true },
      {
        to: '/admin/approvals',
        label: t('nav.approvals'),
        icon: SealCheck,
        prefixes: [],
        badge: counts?.approvals,
        calm: true,
        group: 'work',
        phone: true,
      },
      {
        to: '/admin/curation',
        label: t('nav.curation'),
        icon: ListChecks,
        prefixes: ['/admin/curation'],
        badge: counts?.curation,
        calm: true,
        group: 'work',
        phone: true,
      },
      {
        to: '/admin/orders',
        label: t('nav.orders'),
        icon: Receipt,
        prefixes: ['/admin/orders'],
        badge: counts?.orders,
        group: 'work',
        phone: true,
      },
      {
        to: '/admin/reconciliation',
        label: t('nav.paymentChecks'),
        icon: Scales,
        prefixes: [],
        badge: counts?.payments,
        group: 'work',
      },
      {
        to: '/admin/catalog',
        label: t('nav.catalog'),
        icon: MapTrifold,
        prefixes: ['/admin/catalog'],
        group: 'manage',
      },
      {
        to: '/admin/providers',
        label: t('nav.providers'),
        icon: Handshake,
        prefixes: ['/admin/providers', '/admin/offers'],
        group: 'manage',
      },
      {
        to: '/admin/hosts',
        label: t('nav.hosts'),
        icon: UsersThree,
        prefixes: [],
        group: 'manage',
      },
      {
        to: '/admin/feedback',
        label: t('nav.feedback'),
        icon: ThumbsUp,
        prefixes: [],
        group: 'insight',
      },
      {
        to: '/admin/audit',
        label: t('nav.audit'),
        icon: ClipboardText,
        prefixes: [],
        group: 'insight',
      },
      { to: '/admin/settings', label: t('nav.settings'), icon: GearSix, prefixes: [], foot: true },
    ];
  }
  return [
    { to: '/', label: t('nav.today'), icon: House, prefixes: [] },
    {
      to: '/properties',
      label: t('nav.properties'),
      icon: Buildings,
      prefixes: ['/properties', '/units'],
    },
    { to: '/stays', label: t('nav.stays'), icon: CalendarCheck, prefixes: ['/stays'] },
    { to: '/services', label: t('nav.services'), icon: Storefront, prefixes: ['/services'] },
    { to: '/inbox', label: t('nav.inbox'), icon: Tray, prefixes: ['/inbox'], badge: unread },
    {
      to: '/suggestions',
      label: t('nav.suggestions'),
      short: t('nav.suggestionsShort'),
      icon: Lightbulb,
      prefixes: ['/suggestions'],
    },
    {
      to: '/settings',
      label: t('nav.settings'),
      icon: GearSix,
      prefixes: ['/settings'],
      foot: true,
    },
  ];
}

function Brand() {
  const { t } = useTranslation('shell');
  return (
    <Link to="/" className="brand" aria-label={t('brandHome')}>
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
  const { t, i18n } = useTranslation('shell');
  const { busy, error, run } = useAction();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [unread, setUnread] = useState(0);
  const [counts, setCounts] = useState<AdminCounts | null>(null);
  const [collapsed, setCollapsed] = useState(storedCollapsed);
  const wide = useWide();
  const [folding, setFolding] = useState(false);
  const [title, setTitle] = useState<string | null>(null);
  const foldTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(foldTimer.current), []);
  const hostView = isHostView(me);
  const items = navItems(t, me, unread, counts);
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

  // The page reports its own title; until it does, the current nav item names it.
  const shown = title ?? items.find(isCurrent)?.label ?? 'Fetivi';

  useEffect(() => {
    const previous = document.title;
    document.title = t('documentTitle', { page: shown });
    return () => {
      document.title = previous;
    };
  }, [shown, t]);

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
              aria-label={t('waiting', { count: item.badge })}
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

  const chooseLanguage = (language: BackofficeLanguage) =>
    void run(async () => {
      const next = await auth.setLanguage(language);
      setLanguage(language);
      storeLanguage(language);
      setMe(next);
    });
  const current = currentLanguage();

  const menuItems: MenuItem[] = [
    // The sidebar has Settings at its foot; a host's phone has it only here.
    ...(hostView && !wide
      ? [
          {
            label: t('nav.settings'),
            icon: <GearSix aria-hidden="true" />,
            onSelect: () => navigate('/settings'),
          },
        ]
      : []),
    // Each language under its own name; the current one is checked.
    ...BACKOFFICE_LANGUAGES.map((language, i) => ({
      label: LANGUAGE_NAMES[language],
      lang: language,
      caption: i === 0 ? t('language') : undefined,
      icon:
        language === current ? (
          <Check aria-hidden="true" weight="bold" />
        ) : (
          <Translate aria-hidden="true" />
        ),
      current: language === current,
      onSelect: () => chooseLanguage(language),
    })),
    {
      label: t('signOut'),
      icon: <SignOut aria-hidden="true" />,
      onSelect: () => void run(logout),
    },
  ];

  const profile = (
    <Menu
      label={t('account')}
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
          <span className="menu-caption">{t('signedInAs')}</span>
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
        {t('skipToContent')}
      </a>
      <aside className="sidebar">
        <div className="sidebar-head">
          <Brand />
          <button
            type="button"
            className="ghost icon-button sidebar-toggle"
            aria-label={collapsed ? t('expandSidebar') : t('collapseSidebar')}
            title={collapsed ? t('expandSidebar') : t('collapseSidebar')}
            aria-expanded={!collapsed}
            aria-controls="side-nav"
            onClick={toggle}
          >
            <SidebarSimple aria-hidden="true" />
          </button>
        </div>
        <nav id="side-nav" className="side-nav" aria-label={t('nav.main')}>
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
        <header className="topbar">
          <div className="topbar-title">
            <h1>{shown}</h1>
            <p className="topbar-date">{longDay(todayIso(), i18n.language)}</p>
          </div>
          {profile}
        </header>

        {me.actingAs ? (
          <div className="acting">
            <div className="banner" role="status">
              <span>
                <Trans
                  t={t}
                  i18nKey="acting"
                  values={{ email: me.actingAs.email }}
                  components={{ strong: <strong /> }}
                />
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(async () => setMe(await admin.stopActing()))}
              >
                {t('stopActing')}
              </button>
            </div>
          </div>
        ) : null}

        <div className="content">
          {error ? <p role="alert">{error}</p> : null}
          <main id="main" tabIndex={-1}>
            <PageTitleContext.Provider value={setTitle}>{children}</PageTitleContext.Provider>
          </main>
        </div>
      </div>

      <nav className="bottom-nav" aria-label={t('nav.main')}>
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
  const { t } = useTranslation('shell');
  const waiting = items.reduce((n, item) => n + (item.badge ?? 0), 0);
  const calm = items.every((item) => !item.badge || item.calm);
  return (
    <Menu
      label={t('nav.morePages')}
      className={current ? 'bottom-link bottom-more current' : 'bottom-link bottom-more'}
      align="end"
      up
      trigger={
        <>
          <DotsThreeOutline aria-hidden="true" weight={current ? 'fill' : 'regular'} />
          <span className="nav-label">{t('nav.more')}</span>
          {waiting ? (
            <span
              className={calm ? 'nav-badge calm' : 'nav-badge'}
              role="img"
              aria-label={t('waiting', { count: waiting })}
            >
              {waiting > 99 ? '99+' : waiting}
            </span>
          ) : null}
        </>
      }
      items={items.map((item) => ({
        label: item.badge
          ? t('itemWithCount', { label: item.label, count: item.badge })
          : item.label,
        icon: <item.icon aria-hidden="true" />,
        onSelect: () => navigate(item.to),
      }))}
    />
  );
}
