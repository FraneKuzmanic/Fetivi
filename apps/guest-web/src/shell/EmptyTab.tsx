import { useTranslation } from 'react-i18next';
import { MascotSays } from './Mascot';

export type Tab = 'chat' | 'guide' | 'trip';

/** A tab before its ticket fills it: its name and Fetivi saying what will be here. */
export function EmptyTab({ tab }: { tab: Tab }) {
  const { t } = useTranslation();
  return (
    <section className="empty-tab" aria-labelledby="tab-title">
      <h1 id="tab-title">{t(`tabs.${tab}`)}</h1>
      <MascotSays>{t(`empty.${tab}`)}</MascotSays>
    </section>
  );
}
