import { CornersOut, X } from '@phosphor-icons/react';
import { type RefObject, useEffect, useId, useRef, useState } from 'react';
import type { PlaceCardPayload } from '../../payloads';
import { distanceText } from '../place-carousel/format';
import type { PlaceLabels } from '../place-carousel/PlaceCard';
import { boundsOf, loadMapLibre, MAP_STYLE_URL } from './map';

export type MapListLabels = Pick<
  PlaceLabels,
  'places' | 'expandMap' | 'closeMap' | 'mapUnavailable' | 'km' | 'minutes'
>;

/**
 * Draws the places on a MapLibre map in `container` while `active`; markers carry the list's
 * numbers. Calls `onFail` when MapLibre cannot load (no WebGL, offline).
 */
function useMap(
  container: RefObject<HTMLDivElement | null>,
  places: readonly PlaceCardPayload[],
  opts: { active: boolean; controls: boolean; onFail: () => void },
) {
  const { active, controls, onFail } = opts;
  // The payload is re-parsed on every render; its ids and points are what the map depends on.
  const key = JSON.stringify(places.map((p) => [p.id, p.location]));
  const failRef = useRef(onFail);
  failRef.current = onFail;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `places`.
  useEffect(() => {
    const bounds = boundsOf(places);
    if (!active || !container.current || !bounds) return;
    let cancelled = false;
    let remove: (() => void) | undefined;
    loadMapLibre()
      .then((maplibre) => {
        const element = container.current;
        if (cancelled || !element) return;
        const map = new maplibre.Map({
          container: element,
          style: MAP_STYLE_URL,
          bounds,
          // Extra room at the bottom, where the attribution sits.
          fitBoundsOptions: { padding: { top: 32, right: 32, bottom: 64, left: 32 }, maxZoom: 15 },
          cooperativeGestures: true,
          attributionControl: { compact: true },
        });
        remove = () => map.remove();
        if (controls) map.addControl(new maplibre.NavigationControl({ showCompass: false }));
        places.forEach((place, index) => {
          if (!place.location) return;
          const marker = document.createElement('span');
          marker.className = 'fv-marker';
          marker.textContent = String(index + 1);
          new maplibre.Marker({ element: marker })
            .setLngLat([place.location.lng, place.location.lat])
            .addTo(map);
        });
      })
      .catch(() => {
        if (!cancelled) failRef.current();
      });
    return () => {
      cancelled = true;
      remove?.();
    };
  }, [active, controls, container, key]);
}

/**
 * Places on a map, always with the numbered list. The list comes first in the DOM and is the
 * accessible content; the map is a visual extra (hidden from screen readers) that can expand to
 * full screen. Without a map (no WebGL, offline) the list stays.
 */
export function MapList({
  places,
  labels,
}: {
  places: readonly PlaceCardPayload[];
  labels: MapListLabels;
}) {
  const titleId = useId();
  const inline = useRef<HTMLDivElement>(null);
  const full = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const expand = useRef<HTMLButtonElement>(null);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const hasMap = !failed && boundsOf(places) !== null;
  const fail = () => setFailed(true);

  useMap(inline, places, { active: hasMap, controls: false, onFail: fail });
  useMap(full, places, { active: hasMap && expanded, controls: true, onFail: fail });

  const open = () => {
    // The dialog must be open (and sized) before its map is created.
    dialog.current?.showModal();
    setExpanded(true);
  };
  const close = () => dialog.current?.close();

  const list = (
    <ol className="fv-maplist-list">
      {places.map((place, index) => {
        const distance = distanceText(place, labels);
        return (
          <li key={place.id}>
            <span className="fv-marker" aria-hidden="true">
              {index + 1}
            </span>
            <span className="fv-maplist-text">
              <span className="fv-maplist-title">{place.title}</span>
              {distance && <span className="fv-maplist-meta">{distance}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );

  return (
    <div className="fv-maplist">
      {list}
      {hasMap && (
        <div className="fv-maplist-map">
          <div ref={inline} className="fv-map" aria-hidden="true" />
          <button ref={expand} type="button" className="fv-map-expand" onClick={open}>
            <CornersOut aria-hidden="true" />
            {labels.expandMap}
          </button>
        </div>
      )}
      {failed && (
        <p className="fv-map-note" role="status">
          {labels.mapUnavailable}
        </p>
      )}
      {hasMap && (
        <dialog
          ref={dialog}
          className="fv-map-dialog"
          aria-labelledby={titleId}
          onClose={() => {
            setExpanded(false);
            expand.current?.focus();
          }}
        >
          <div className="fv-map-dialog-bar">
            <h2 id={titleId}>{labels.places}</h2>
            <button type="button" className="fv-map-close" onClick={close}>
              <X aria-hidden="true" />
              {labels.closeMap}
            </button>
          </div>
          <div ref={full} className="fv-map fv-map-full" aria-hidden="true" />
          {expanded && list}
        </dialog>
      )}
    </div>
  );
}
