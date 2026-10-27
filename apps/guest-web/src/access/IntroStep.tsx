import { ArrowRight } from '@phosphor-icons/react';
import type { Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { FetiviStage } from './FetiviStage';

/** The first screen on a unit link: Fetivi introduces himself, then hands over to the language. */
export function IntroStep({
  onStart,
  headingRef,
}: {
  onStart: () => void;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const { t } = useTranslation();
  return (
    <>
      <FetiviStage size="large">
        <h1 ref={headingRef} tabIndex={-1}>
          {t('intro.title')}
        </h1>
        <p>{t('intro.body')}</p>
      </FetiviStage>
      <div className="onboarding-actions">
        <button type="button" className="button onboarding-button" onClick={onStart}>
          {t('intro.start')}
          <ArrowRight aria-hidden="true" weight="bold" />
        </button>
      </div>
    </>
  );
}
