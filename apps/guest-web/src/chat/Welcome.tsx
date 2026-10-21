import { useTranslation } from 'react-i18next';
import { MascotSays } from '../shell/Mascot';

/** The fixed, pre-written welcome; always first, never stored. */
export function Welcome() {
  const { t } = useTranslation();
  return <MascotSays>{t('chat.welcome')}</MascotSays>;
}
