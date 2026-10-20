import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { MascotSays } from './Mascot';

export const TAB_NAMES = ['chat', 'guide', 'trip'] as const;
export type Tab = (typeof TAB_NAMES)[number];

/** A tab before its ticket fills it: its name and Fetivi saying what will be here. */
export function EmptyTab({ tab }: { tab: Tab }) {
  const { t } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);

  // Landing on a tab (after the PIN or from the tab bar) starts reading at its heading.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the tab change is the trigger.
  useEffect(() => {
    heading.current?.focus();
  }, [tab]);

  return (
    <section className="empty-tab" aria-labelledby="tab-title">
      <h1 id="tab-title" ref={heading} tabIndex={-1}>
        {t(`tabs.${tab}`)}
      </h1>
      <MascotSays>{t(`empty.${tab}`)}</MascotSays>
    </section>
  );
}
