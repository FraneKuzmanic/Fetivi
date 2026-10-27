import { useTranslation } from 'react-i18next';
import { FetiviStage } from './FetiviStage';

const MESSAGE = {
  none: 'link.none',
  'not-found': 'link.notFound',
  offline: 'error.network',
} as const;

/** Everything a device without a space sees outside a unit link. No navigation, no content. */
export function NoLinkPage({ reason = 'none' }: { reason?: keyof typeof MESSAGE }) {
  const { t } = useTranslation();
  return (
    <main className="onboarding">
      <h1 className="visually-hidden">Fetivi</h1>
      <FetiviStage size="large">
        <p>{t(MESSAGE[reason])}</p>
      </FetiviStage>
    </main>
  );
}
