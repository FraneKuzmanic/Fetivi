import type { FallbackSourceKind } from '@fetivi/domain/fallback-vocabulary';
import { Boat, CloudSun, type Icon, MapTrifold, Storefront } from '@phosphor-icons/react';

export const KIND_ICONS: Record<FallbackSourceKind, Icon> = {
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
  labels: { kind: (kind: FallbackSourceKind) => string };
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
