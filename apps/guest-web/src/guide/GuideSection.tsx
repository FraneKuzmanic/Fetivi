import type { GuestProjection } from '@fetivi/domain/projection-types';
import type { BlockCategory } from '@fetivi/domain/vocabulary';
import { InfoMedia, PropertyInfoCard } from '@fetivi/ui';
import { type PropertyInfoTopic, propertyInfo, TOPIC_CATEGORY } from '@fetivi/ui/payloads';
import { Car, CaretDown, CaretLeft, Check } from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useParams } from 'react-router';
import { MascotSays } from '../shell/Mascot';
import { useSpace } from '../space';
import { BlockBody, topicsOf } from './BlockBody';
import { UnitGate } from './GuideTab';
import { mediaUrl } from './guide-api';
import { HostPicksSection } from './HostPicksSection';
import { propertyInfoLabels } from './labels';
import { SavedPlacesSection } from './SavedPlacesSection';
import { sectionBySlug } from './sections';
import { useUnit } from './useUnit';

const TOPIC_OF = Object.fromEntries(
  Object.entries(TOPIC_CATEGORY).map(([topic, category]) => [category, topic]),
) as Partial<Record<BlockCategory, PropertyInfoTopic>>;

/**
 * The host's blocks of one section as topics that open in place: the title and, while closed,
 * the topic lines inside it; open, the Markdown and the host's photos and videos. A section with
 * a single block shows it open.
 */
export function Blocks({ blocks }: { blocks: GuestProjection['blocks'] }) {
  if (blocks.length === 0) return null;
  return (
    <div className="guide-topics">
      {blocks.map((block, i) => (
        // Blocks carry no id; their order within a section is stable for one response.
        // biome-ignore lint/suspicious/noArrayIndexKey: see above.
        <Topic key={i} block={block} startOpen={blocks.length === 1} />
      ))}
    </div>
  );
}

function Topic({
  block,
  startOpen,
}: {
  block: GuestProjection['blocks'][number];
  startOpen: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const bodyId = useId();
  const topics = topicsOf(block.body);
  return (
    <section className="guide-topic" data-open={open}>
      <h2>
        <button
          type="button"
          className="guide-topic-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="guide-topic-text">
            <span className="guide-topic-title">{block.title}</span>
            {topics.length > 0 && <span className="guide-topic-hint">{topics.join(' · ')}</span>}
          </span>
          <CaretDown size={20} aria-hidden="true" className="guide-topic-caret" />
        </button>
      </h2>
      <div id={bodyId} className="guide-topic-body" hidden={!open}>
        <BlockBody markdown={block.body} />
        <InfoMedia media={block.media} mediaUrl={mediaUrl} />
      </div>
    </section>
  );
}

function Essentials({ unit }: { unit: GuestProjection }) {
  const { t } = useTranslation();
  const { amenities, parking } = unit;
  const hasParking = parking.type !== null || parking.notes !== null;
  return (
    <>
      {amenities.length > 0 ? (
        <section className="guide-block">
          <h2>{t('guide.amenities')}</h2>
          <ul className="guide-amenities">
            {amenities.map((a) => (
              <li key={a.amenity} className="guide-amenity">
                <Check aria-hidden="true" weight="bold" className="guide-amenity-check" />
                <span>
                  {t(`amenity.${a.amenity}`)}
                  {a.note ? <span className="guide-note"> · {a.note}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {hasParking ? (
        <section className="guide-block guide-parking">
          <span className="guide-parking-icon">
            <Car aria-hidden="true" />
          </span>
          <div>
            <h2>{t('guide.parking')}</h2>
            {parking.type ? <p>{t(`parkingType.${parking.type}`)}</p> : null}
            {parking.notes ? <p className="guide-note">{parking.notes}</p> : null}
          </div>
        </section>
      ) : null}
    </>
  );
}

function SectionContent({ category, unit }: { category: BlockCategory; unit: GuestProjection }) {
  const { t, i18n } = useTranslation();
  const { state: space } = useSpace();
  const blocks = unit.blocks.filter((b) => b.category === category);

  if (category === 'saved_places') {
    return <SavedPlacesSection closed={space.status === 'ready' && space.space.closed} />;
  }
  if (category === 'host_picks') {
    return (
      <HostPicksSection
        closed={space.status === 'ready' && space.space.closed}
        tips={blocks.length > 0 ? <Blocks blocks={blocks} /> : null}
      />
    );
  }
  const topic = TOPIC_OF[category];
  // The section's own blocks show their media below; the card shows only the typed facts.
  const card = topic ? { ...propertyInfo(unit, topic), media: [] } : null;
  const cardShows = card !== null && (card.fields.length > 0 || card.topic === 'wifi');
  const essentials = category === 'wifi_essentials';

  if (!cardShows && blocks.length === 0 && !essentials) {
    return <MascotSays>{t('guide.nothingYet')}</MascotSays>;
  }
  return (
    <>
      {card && cardShows ? (
        <PropertyInfoCard
          info={card}
          mediaUrl={mediaUrl}
          labels={propertyInfoLabels(t, i18n.language)}
          headingLevel={2}
        />
      ) : null}
      {essentials ? <Essentials unit={unit} /> : null}
      <Blocks blocks={blocks} />
    </>
  );
}

/** One Guide section, at /guide/:section. */
export function GuideSection() {
  const { t } = useTranslation();
  const { section: slug } = useParams();
  const section = sectionBySlug(slug);
  const heading = useRef<HTMLHeadingElement>(null);
  const { state, reload } = useUnit();

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new section is the trigger.
  useEffect(() => {
    heading.current?.focus();
  }, [slug]);

  if (!section) return <Navigate to="/guide" replace />;
  const SectionIcon = section.icon;
  return (
    <section className="guide" aria-labelledby="tab-title">
      <Link to="/guide" className="guide-back">
        <CaretLeft size={20} aria-hidden="true" />
        {t('guide.back')}
      </Link>
      <header className="guide-header">
        <span className="guide-icon guide-icon-lg" data-group={section.group}>
          <SectionIcon aria-hidden="true" />
        </span>
        <div className="guide-header-text">
          <h1 id="tab-title" ref={heading} tabIndex={-1}>
            {t(`guide.${section.category}`)}
          </h1>
          <p className="guide-header-hint">{t(`guide.hint_${section.category}`)}</p>
        </div>
      </header>
      <UnitGate state={state} reload={reload}>
        {(unit) => (
          <div className="guide-content">
            <SectionContent category={section.category} unit={unit} />
          </div>
        )}
      </UnitGate>
    </section>
  );
}
