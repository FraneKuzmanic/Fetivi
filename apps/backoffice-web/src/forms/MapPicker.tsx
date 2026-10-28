import type { GeocodeKind, GeoPlace } from '@fetivi/domain/geocode-vocabulary';
import { loadMapLibre, MAP_STYLE_URL } from '@fetivi/ui';
import { MapPin } from '@phosphor-icons/react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { geo } from '../api';
import { i18next } from '../i18n';
import { circlePolygon } from './circle';
import { NumberField } from './fields';
import { SearchField } from './SearchField';

export interface MapPoint {
  lat: number | null;
  lng: number | null;
}

type MapLibre = Awaited<ReturnType<typeof loadMapLibre>>;
type MapInstance = InstanceType<MapLibre['Map']>;
type GeoJSONSource = InstanceType<MapLibre['GeoJSONSource']>;
type LngLatBounds = [[number, number], [number, number]];

/** Where the map opens before there is a pin: Trogir, the pilot. */
const START = { lat: 43.517, lng: 16.2514 };
const DEBOUNCE_MS = 300;
const PIN_COLOUR = '#0047ab';
const NO_AREA = { type: 'FeatureCollection' as const, features: [] };

/** Shown, and thrown by the form on submit, while a required point is missing. */
export const noLocation = () => i18next.t('field.noLocation');

/** Six decimals is about 10 cm; a map click gives sixteen. */
const coord = (n: number | null) => (n === null ? null : Number(n.toFixed(6)));

/** Suggestions for `text` after a pause in typing; a slower, older answer never wins. */
export function useGeoSearch(
  text: string,
  kind: GeocodeKind,
  near: { lat: number; lng: number } | null,
) {
  const [places, setPlaces] = useState<GeoPlace[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const latest = useRef(0);
  const nearKey = near ? `${near.lat.toFixed(2)},${near.lng.toFixed(2)}` : '';

  // biome-ignore lint/correctness/useExhaustiveDependencies: `nearKey` stands for `near`.
  useEffect(() => {
    const q = text.trim();
    if (q.length < 3) {
      setPlaces([]);
      setLoading(false);
      return;
    }
    const call = ++latest.current;
    setLoading(true);
    const timer = setTimeout(() => {
      geo.search(q, { kind, near: near ?? START }).then(
        ({ places: found }) => {
          if (call !== latest.current) return;
          setPlaces(found);
          setFailed(false);
          setLoading(false);
        },
        () => {
          if (call !== latest.current) return;
          setPlaces([]);
          setFailed(true);
          setLoading(false);
        },
      );
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, kind, nearKey]);

  return { places, loading, failed };
}

/** Geocoder results as search options; labels can repeat, so the index keeps ids unique. */
export const placeOptions = (places: GeoPlace[]) =>
  places.map((p, i) => ({ ...p, id: `${i}:${p.label}`, label: p.label }));

const pointOf = (value: MapPoint) =>
  value.lat !== null && value.lng !== null ? { lat: value.lat, lng: value.lng } : null;

/** The box around a circle's ring, for fitting the view to a destination's area. */
function areaBounds(centre: { lat: number; lng: number }, radiusKm: number): LngLatBounds {
  const ring = circlePolygon(centre, radiusKm, 16).geometry.coordinates[0] ?? [];
  const lngs = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}

/**
 * A MapLibre map with one pin, dragged or placed with a click, and an optional area circle.
 * Hidden from screen readers: the coordinate fields are the accessible path.
 */
function LocationMap({
  point,
  withArea,
  radiusKm,
  onMove,
  onFail,
}: {
  point: { lat: number; lng: number } | null;
  /** Draws the area layer; `radiusKm` null or 0 leaves it empty. */
  withArea: boolean;
  radiusKm: number | null;
  onMove: (lat: number, lng: number) => void;
  onFail: () => void;
}) {
  const { t } = useTranslation();
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapInstance | null>(null);
  const pin = useRef<InstanceType<MapLibre['Marker']> | null>(null);
  const [failed, setFailed] = useState(false);
  const move = useRef(onMove);
  move.current = onMove;
  const fail = useRef(onFail);
  fail.current = onFail;
  // The newest point and radius, for the area layer added once the style has loaded.
  const area = useRef({ point, radiusKm });
  area.current = { point, radiusKm };
  const initial = useRef(point);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the map is built once; `withArea` never changes for a form.
  useEffect(() => {
    let cancelled = false;
    let remove: (() => void) | undefined;
    loadMapLibre()
      .then((maplibre) => {
        const element = container.current;
        if (cancelled || !element) return;
        const at = initial.current ?? START;
        const { radiusKm: r } = area.current;
        const m = new maplibre.Map({
          container: element,
          style: MAP_STYLE_URL,
          ...(initial.current && r
            ? { bounds: areaBounds(initial.current, r), fitBoundsOptions: { padding: 24 } }
            : { center: [at.lng, at.lat] as [number, number], zoom: initial.current ? 17 : 13 }),
          cooperativeGestures: true,
          attributionControl: { compact: true },
          locale: {
            'Map.Title': t('map.title'),
            'Marker.Title': t('map.marker'),
            'NavigationControl.ZoomIn': t('map.zoomIn'),
            'NavigationControl.ZoomOut': t('map.zoomOut'),
            'AttributionControl.ToggleAttribution': t('map.attribution'),
            'AttributionControl.MapFeedback': t('map.feedback'),
            'CooperativeGesturesHandler.WindowsHelpText': t('map.ctrlScroll'),
            'CooperativeGesturesHandler.MacHelpText': t('map.cmdScroll'),
            'CooperativeGesturesHandler.MobileHelpText': t('map.twoFingers'),
          },
        });
        m.addControl(new maplibre.NavigationControl({ showCompass: false }));
        const marker = new maplibre.Marker({ draggable: true, color: PIN_COLOUR });
        if (initial.current) marker.setLngLat([at.lng, at.lat]).addTo(m);
        marker.on('dragend', () => {
          const { lat, lng } = marker.getLngLat();
          move.current(lat, lng);
        });
        m.on('click', (event) => {
          marker.setLngLat(event.lngLat).addTo(m);
          move.current(event.lngLat.lat, event.lngLat.lng);
        });
        if (withArea) {
          // Layers can only be added once the style has loaded.
          m.on('load', () => {
            const now = area.current;
            m.addSource('area', {
              type: 'geojson',
              data: now.point && now.radiusKm ? circlePolygon(now.point, now.radiusKm) : NO_AREA,
            });
            m.addLayer({
              id: 'area-fill',
              type: 'fill',
              source: 'area',
              paint: { 'fill-color': PIN_COLOUR, 'fill-opacity': 0.08 },
            });
            m.addLayer({
              id: 'area-line',
              type: 'line',
              source: 'area',
              paint: { 'line-color': PIN_COLOUR, 'line-width': 2 },
            });
          });
        }
        map.current = m;
        pin.current = marker;
        remove = () => m.remove();
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        fail.current();
      });
    return () => {
      cancelled = true;
      remove?.();
      map.current = null;
      pin.current = null;
    };
  }, []);

  // A point from the search or the fields (not from the pin itself) moves the pin and the view.
  const key = point ? `${point.lat.toFixed(6)},${point.lng.toFixed(6)}` : '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `point`.
  useEffect(() => {
    const m = map.current;
    if (!point || !m) return;
    pin.current?.setLngLat([point.lng, point.lat]).addTo(m);
    // With an area, the effect below fits the view to the circle instead.
    if (!withArea) m.flyTo({ center: [point.lng, point.lat], zoom: 17 });
  }, [key]);

  // The area circle follows the centre and the radius.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `point`.
  useEffect(() => {
    const m = map.current;
    const source = m?.getSource('area') as GeoJSONSource | undefined;
    if (!m || !source) return;
    if (!point || !radiusKm) {
      source.setData(NO_AREA);
      if (point) m.flyTo({ center: [point.lng, point.lat] });
      return;
    }
    source.setData(circlePolygon(point, radiusKm));
    m.fitBounds(areaBounds(point, radiusKm), { padding: 24 });
  }, [key, radiusKm]);

  if (failed) {
    return <p className="muted">{t('misc.mapFailed')}</p>;
  }
  return <div ref={container} className="location-map" aria-hidden="true" />;
}

/**
 * The one place in the back office where a location is picked: search a place or address, click
 * or drag the pin, or type the coordinates by hand (the keyboard path, open by itself when the map
 * cannot load). With `radiusKm` it also draws a destination's area.
 */
export function MapPicker({
  label,
  value,
  onChange,
  search,
  onPinMoved,
  radiusKm,
  hint,
  required,
}: {
  label: string;
  value: MapPoint;
  onChange: (point: MapPoint) => void;
  /** A search box above the map; omitted where the caller has its own (the property address). */
  search?: {
    label: string;
    placeholder?: string;
    kind: GeocodeKind;
    onPick?: (place: GeoPlace) => void;
  };
  /** Called after the pin moves (drag or click), e.g. to read the address there. */
  onPinMoved?: (lat: number, lng: number) => void;
  /** Draws the destination's area around the point; null draws nothing yet. */
  radiusKm?: number | null;
  hint?: ReactNode;
  /** Shows that a point is still missing; the caller checks it before saving. */
  required?: boolean;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [manual, setManual] = useState(false);
  const point = pointOf(value);
  const found = useGeoSearch(search ? text : '', search?.kind ?? 'address', point);

  const pinMoved = (rawLat: number, rawLng: number) => {
    const lat = coord(rawLat) as number;
    const lng = coord(rawLng) as number;
    onChange({ lat, lng });
    onPinMoved?.(lat, lng);
  };

  return (
    <div className="map-picker">
      {search ? (
        <SearchField
          label={search.label}
          placeholder={search.placeholder}
          value={text}
          onText={setText}
          options={placeOptions(found.places)}
          loading={found.loading}
          message={
            found.failed
              ? t('field.searchUnavailable')
              : text.trim().length >= 3
                ? t('field.nothingFound')
                : null
          }
          onPick={(place) => {
            onChange({ lat: place.lat, lng: place.lng });
            search.onPick?.(place);
            setText('');
          }}
        />
      ) : null}
      <div className="field">
        <span className="field-label with-icon">
          <MapPin aria-hidden="true" />
          {label}
        </span>
        <LocationMap
          point={point}
          withArea={radiusKm !== undefined}
          radiusKm={radiusKm ?? null}
          onMove={pinMoved}
          onFail={() => setManual(true)}
        />
        {hint ? <small>{hint}</small> : null}
        {required && !point ? <small>{t('field.noLocation')}</small> : null}
        <button type="button" className="link-button" onClick={() => setManual(!manual)}>
          {manual ? t('field.hideCoordinates') : t('field.enterCoordinates')}
        </button>
      </div>
      {manual ? (
        <div className="field-row">
          <NumberField
            label={t('field.latitude')}
            value={coord(value.lat)}
            min={-90}
            max={90}
            step="any"
            onChange={(lat) => onChange({ ...value, lat })}
          />
          <NumberField
            label={t('field.longitude')}
            value={coord(value.lng)}
            min={-180}
            max={180}
            step="any"
            onChange={(lng) => onChange({ ...value, lng })}
          />
        </div>
      ) : null}
    </div>
  );
}
