import { gapTarget } from '@fetivi/domain/suggestion-vocabulary';
import type { BlockCategory } from '@fetivi/domain/vocabulary';
import {
  ArrowRight,
  type Icon,
  Key,
  Lightbulb,
  MapPin,
  Phone,
  Scroll,
  Star,
  Toolbox,
  WifiHigh,
} from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { type HostSuggestion, host } from '../../api';
import { EmptyState } from '../../shell/EmptyState';
import { usePageTitle } from '../../shell/PageTitle';
import { useAction } from '../../useAction';
import { useWizardCopy } from '../wizard/copy';

/** Each guide section's icon, shared with the section a suggestion belongs to. */
export const SECTION_ICONS: Record<BlockCategory, Icon> = {
  arrival_access: Key,
  wifi_essentials: WifiHigh,
  house_rules_checkout: Scroll,
  how_tos: Toolbox,
  saved_places: MapPin,
  host_picks: Star,
  contacts_emergency: Phone,
};

/**
 * What guests asked Fetivi about that the host's setup does not cover (44 AC 3): Fetivi's
 * sentence, the guide section it belongs in, and a link to that wizard field. What guests wrote is
 * never shown (AC 4).
 */
export function SuggestionsPage() {
  const { error, run } = useAction();
  const { steps } = useWizardCopy();
  const [suggestions, setSuggestions] = useState<HostSuggestion[] | null>(null);

  useEffect(() => {
    void run(async () => setSuggestions((await host.suggestions()).suggestions));
  }, [run]);

  const several = new Set(suggestions?.map((s) => s.unitId)).size > 1;

  usePageTitle('Suggestions');

  return (
    <>
      {suggestions === null ? (
        error ? (
          <p role="alert">{error}</p>
        ) : (
          <p className="muted">Loading…</p>
        )
      ) : suggestions.length > 0 ? (
        <ul className="rows suggestion-list">
          {suggestions.map((s) => {
            const { stepId } = gapTarget(s.topic);
            const Glyph = SECTION_ICONS[stepId];
            return (
              <li key={s.id} className="suggestion-row">
                <span className="suggestion-icon" aria-hidden="true">
                  <Glyph />
                </span>
                <div className="block-text">
                  <strong>{s.text}</strong>
                  <span className="entry-meta">
                    {[`In the guide under ${steps[stepId].title}`, several ? s.unitName : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>
                <Link className="button" to={s.wizardPath}>
                  Add to the guide
                  <ArrowRight aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState icon={Lightbulb} title="Your guide covers what guests ask">
          When guests in two different stays ask about something your setup does not cover, it shows
          up here with a link to add it.
        </EmptyState>
      )}
    </>
  );
}
