import { Bell, CreditCard, UserCircle } from '@phosphor-icons/react';
import { Link, useLocation } from 'react-router';
import { usePageTitle } from '../../shell/PageTitle';

const TABS = [
  { to: '/settings/notifications', label: 'Notifications', icon: Bell },
  { to: '/settings/payments', label: 'Payments', icon: CreditCard },
  { to: '/settings/account', label: 'Account', icon: UserCircle },
];

/** The Settings title (in the header) and its tabs, above each settings page. */
export function SettingsTabs() {
  const { pathname } = useLocation();
  usePageTitle('Settings');

  return (
    <nav className="tabs" aria-label="Settings">
      {TABS.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          className="tab-link"
          aria-current={pathname === tab.to ? 'page' : undefined}
        >
          <tab.icon aria-hidden="true" />
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
