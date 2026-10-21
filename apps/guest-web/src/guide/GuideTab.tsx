import { CaretRight } from '@phosphor-icons/react';
import { type ReactNode, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { MascotSays } from '../shell/Mascot';
import { GUIDE_SECTIONS } from './sections';
import { type UnitState, useUnit } from './useUnit';

/** Loading and error states shared by the Guide pages; `children` once the unit is in. */
export function UnitGate({
  state,
  reload,
  children,
}: {
  state: UnitState;
  reload: () => void;
  children: (unit: Extract<UnitState, { status: 'ready' }>['unit']) => ReactNode;
}) {
  const { t } = useTranslation();
  if (state.status === 'loading') return <p className="status">{t('common.loading')}</p>;
  if (state.status === 'error') {
    return (
      <div className="guide-error">
        <MascotSays>{t('guide.loadError')}</MascotSays>
        <button type="button" className="button" onClick={reload}>
          {t('guide.retry')}
        </button>
      </div>
    );
  }
  return children(state.unit);
}

/** The Guide's index: Fetivi's greeting and the seven sections. No model is involved. */
export function GuideTab() {
  const { t } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  const { state, reload } = useUnit();

  // Landing on the tab starts reading at its heading.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <section className="guide" aria-labelledby="tab-title">
      <h1 id="tab-title" ref={heading} tabIndex={-1}>
        {t('tabs.guide')}
      </h1>
      <UnitGate state={state} reload={reload}>
        {(unit) => (
          <>
            <MascotSays>{t('guide.greeting', { name: unit.property.name })}</MascotSays>
            <nav aria-label={t('guide.sectionsLabel')}>
              <ul className="guide-index">
                {GUIDE_SECTIONS.map(({ category, slug, icon: SectionIcon }) => (
                  <li key={slug}>
                    <Link to={`/guide/${slug}`} className="guide-row">
                      <span className="guide-row-icon">
                        <SectionIcon size={24} aria-hidden="true" />
                      </span>
                      <span className="guide-row-text">
                        <span className="guide-row-name">{t(`guide.${category}`)}</span>
                        <span className="guide-row-hint">{t(`guide.hint_${category}`)}</span>
                      </span>
                      <CaretRight size={20} aria-hidden="true" className="guide-row-caret" />
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </>
        )}
      </UnitGate>
    </section>
  );
}
