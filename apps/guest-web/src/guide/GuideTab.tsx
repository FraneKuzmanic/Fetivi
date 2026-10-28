import { CaretRight } from '@phosphor-icons/react';
import { type ReactNode, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { MascotSays } from '../shell/Mascot';
import { GUIDE_GROUPS, GUIDE_SECTIONS } from './sections';
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

/** The Guide's index: Fetivi's greeting and the seven sections in three groups. No model call. */
export function GuideTab() {
  const { t } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  const { state, reload } = useUnit();

  // Landing on the tab starts reading at its heading.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <section className="guide guide-home" aria-labelledby="tab-title">
      <h1 id="tab-title" ref={heading} tabIndex={-1} className="visually-hidden">
        {t('tabs.guide')}
      </h1>
      <UnitGate state={state} reload={reload}>
        {(unit) => (
          <>
            <MascotSays>{t('guide.greeting', { name: unit.property.name })}</MascotSays>
            <nav aria-label={t('guide.sectionsLabel')} className="guide-nav">
              {GUIDE_GROUPS.map((group) => (
                <div key={group} className="guide-group">
                  <h2 id={`guide-group-${group}`}>{t(`guide.group_${group}`)}</h2>
                  <ul className="guide-index" aria-labelledby={`guide-group-${group}`}>
                    {GUIDE_SECTIONS.filter((s) => s.group === group).map(
                      ({ category, slug, icon: SectionIcon }) => (
                        <li key={slug}>
                          <Link to={`/guide/${slug}`} className="guide-row">
                            <span className="guide-icon" data-group={group}>
                              <SectionIcon aria-hidden="true" />
                            </span>
                            <span className="guide-row-text">
                              <span className="guide-row-name">{t(`guide.${category}`)}</span>
                              <span className="guide-row-hint">{t(`guide.hint_${category}`)}</span>
                            </span>
                            <CaretRight size={20} aria-hidden="true" className="guide-row-caret" />
                          </Link>
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              ))}
            </nav>
          </>
        )}
      </UnitGate>
    </section>
  );
}
