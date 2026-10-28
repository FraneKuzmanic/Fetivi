import type { FallbackSourceKind } from '@fetivi/domain/fallback-vocabulary';
import { useId } from 'react';
import type { WebResultsPayload } from '../../payloads';
import { KIND_ICONS } from './SourceChip';

/** Every visible string of the source row; the app translates them. */
export interface SourceRowLabels {
  /** The row's name, e.g. "From the web, not checked by Fetivi". */
  label: string;
  kind: (kind: FallbackSourceKind) => string;
  /** Only for screen readers, after each link. */
  opensInNewTab: string;
}

/**
 * The web results of an answer that cited none of them: one compact row of site links, so the
 * sources stay reachable without a reference list. Never place cards: nothing to save or book.
 */
export function SourceRow({
  results,
  labels,
}: {
  results: WebResultsPayload['results'];
  labels: SourceRowLabels;
}) {
  const labelId = useId();
  return (
    <div className="fv-source-row">
      <span id={labelId} className="fv-source-row-label">
        {labels.label}
      </span>
      <ul className="fv-source-row-links" aria-labelledby={labelId}>
        {results.map((r) => {
          const KindIcon = KIND_ICONS[r.source.kind];
          return (
            <li key={r.url}>
              <a
                className="fv-source-chip"
                href={r.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                title={r.title}
              >
                <KindIcon size={16} aria-hidden="true" />
                <span className="fv-source-chip-host">{r.source.host}</span>
                <span className="fv-visually-hidden">
                  {` ${labels.kind(r.source.kind)}: ${r.title} (${labels.opensInNewTab})`}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
