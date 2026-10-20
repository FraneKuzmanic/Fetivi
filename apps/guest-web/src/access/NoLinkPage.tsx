import { useTranslation } from 'react-i18next';
import { MascotSays } from '../shell/Mascot';

/** Everything a device without a space sees outside a unit link. No navigation, no content. */
export function NoLinkPage({ reason = 'none' }: { reason?: 'none' | 'not-found' }) {
  const { t } = useTranslation();
  return (
    <main className="access">
      <h1 className="access-brand">Fetivi</h1>
      <MascotSays>{reason === 'not-found' ? t('link.notFound') : t('link.none')}</MascotSays>
    </main>
  );
}
