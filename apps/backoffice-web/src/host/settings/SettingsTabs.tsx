import { Bell, CreditCard, UserCircle } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { usePageTitle } from '../../shell/PageTitle';

const TABS = [
  { to: '/settings/notifications', key: 'notifications', icon: Bell },
  { to: '/settings/payments', key: 'payments', icon: CreditCard },
  { to: '/settings/account', key: 'account', icon: UserCircle },
] as const;

/** The Settings title (in the header) and its tabs, above each settings page. */
export function SettingsTabs() {
  const { pathname } = useLocation();
  const { t } = useTranslation(['host', 'common']);
  usePageTitle(t('settings.title'));

  return (
    <nav className="tabs" aria-label={t('settings.title')}>
      {TABS.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          className="tab-link"
          aria-current={pathname === tab.to ? 'page' : undefined}
        >
          <tab.icon aria-hidden="true" />
          {t(`settings.${tab.key}`)}
        </Link>
      ))}
    </nav>
  );
}
