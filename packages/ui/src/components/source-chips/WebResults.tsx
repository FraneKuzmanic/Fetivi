import type { FallbackSourceKind } from '@fetivi/domain/fallback-vocabulary';
import {
  Boat,
  CloudSun,
  GlobeHemisphereEast,
  type Icon,
  MapTrifold,
  Storefront,
} from '@phosphor-icons/react';
import { useId } from 'react';
import type { WebResultsPayload } from '../../payloads';

/** Every visible string of the web results; the app translates them. */
export interface WebResultsLabels {
  heading: string;
  notChecked: string;
  kind: (kind: FallbackSourceKind) => string;
  /** Only for screen readers, after each link. */
  opensInNewTab: string;
}

const KIND_ICONS: Record<FallbackSourceKind, Icon> = {
  tourist_board: MapTrifold,
  ferry_operator: Boat,
  weather_service: CloudSun,
  venue: Storefront,
};

/** Where a web result comes from: the site and what kind of source it is. */
export function SourceChip({
  host,
  kind,
  labels,
}: {
  host: string;
  kind: FallbackSourceKind;
  labels: Pick<WebResultsLabels, 'kind'>;
}) {
  const KindIcon = KIND_ICONS[kind];
  return (
    <span className="fv-source-chip">
      <KindIcon size={16} aria-hidden="true" />
      <span className="fv-source-chip-host">{host}</span>
      <span aria-hidden="true">·</span>
      <span>{labels.kind(kind)}</span>
    </span>
  );
}

/**
 * web_fallback_search's results: unchecked pages from allowlisted sites as plain links with their
 * source. Never place cards: no image, map, save or booking action.
 */
export function WebResults({
  results,
  labels,
}: {
  results: WebResultsPayload['results'];
  labels: WebResultsLabels;
}) {
  const headingId = useId();
  return (
    <section className="fv-web-results" aria-labelledby={headingId}>
      <div className="fv-web-results-head">
        <h3 id={headingId} className="fv-web-results-heading">
          <GlobeHemisphereEast size={20} aria-hidden="true" />
          {labels.heading}
        </h3>
        <p className="fv-web-results-note">{labels.notChecked}</p>
      </div>
      <ul className="fv-web-results-list">
        {results.map((r) => (
          <li key={r.url} className="fv-web-result">
            <a
              className="fv-web-result-title"
              href={r.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
            >
              {r.title}
              <span className="fv-visually-hidden"> ({labels.opensInNewTab})</span>
            </a>
            {r.snippet && <p className="fv-web-result-snippet">{r.snippet}</p>}
            <SourceChip host={r.source.host} kind={r.source.kind} labels={labels} />
          </li>
        ))}
      </ul>
    </section>
  );
}
