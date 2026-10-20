import { useTranslation } from 'react-i18next';
import { MascotSays } from '../shell/Mascot';

const MESSAGE = {
  none: 'link.none',
  'not-found': 'link.notFound',
  offline: 'error.network',
} as const;

/** Everything a device without a space sees outside a unit link. No navigation, no content. */
export function NoLinkPage({ reason = 'none' }: { reason?: keyof typeof MESSAGE }) {
  const { t } = useTranslation();
  return (
    <main className="access">
      <h1 className="access-brand">Fetivi</h1>
      <MascotSays>{t(MESSAGE[reason])}</MascotSays>
    </main>
  );
}
