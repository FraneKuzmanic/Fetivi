import type { GeocodeKind, GeoPlace } from '@fetivi/domain/geocode-vocabulary';
import { LIMITS } from '@fetivi/domain/vocabulary';
import { loadMapLibre, MAP_STYLE_URL } from '@fetivi/ui';
import { MapPin } from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState } from 'react';
import { host } from '../../api';
import { countryOptions } from '../../forms/countries';
import { NumberField, TextField } from '../../forms/fields';
import { SearchField } from '../../forms/SearchField';

export interface AddressValue {
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  /** ISO 3166-1 alpha-2; undefined where the form has no country (the setup wizard). */
  country?: string;
  lat: number | null;
  lng: number | null;
}

/** Where the map opens before there is a pin: Trogir, the pilot. */
const START = { lat: 43.517, lng: 16.2514 };
const COUNTRIES = countryOptions();
const DEBOUNCE_MS = 300;

/** Suggestions for `text` after a pause in typing; a slower, older answer never wins. */
function useGeoSearch(text: string, kind: GeocodeKind, near: { lat: number; lng: number } | null) {
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
      host.geocode(q, { kind, near: near ?? START }).then(
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

/** The house number the host typed, kept when the picked result is only the street. */
function houseNumberOf(text: string): string | null {
  return /\b(\d+[a-zA-Z]?)\b/.exec(text)?.[1] ?? null;
}

/** A map with one pin the host drags or places with a click. Hidden from screen readers. */
function LocationMap({
  point,
  onMove,
}: {
  point: { lat: number; lng: number } | null;
  onMove: (lat: number, lng: number) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<{ setCenter: (c: [number, number]) => void } | null>(null);
  const marker = useRef<{ setLngLat: (c: [number, number]) => unknown } | null>(null);
  const [failed, setFailed] = useState(false);
  const move = useRef(onMove);
  move.current = onMove;
  const initial = useRef(point);

  useEffect(() => {
    let cancelled = false;
    let remove: (() => void) | undefined;
    loadMapLibre()
      .then((maplibre) => {
        const element = container.current;
        if (cancelled || !element) return;
        const at = initial.current ?? START;
        const m = new maplibre.Map({
          container: element,
          style: MAP_STYLE_URL,
          center: [at.lng, at.lat],
          zoom: initial.current ? 17 : 13,
          cooperativeGestures: true,
          attributionControl: { compact: true },
        });
        m.addControl(new maplibre.NavigationControl({ showCompass: false }));
        const pin = new maplibre.Marker({ draggable: true, color: '#0047ab' });
        if (initial.current) pin.setLngLat([at.lng, at.lat]).addTo(m);
        pin.on('dragend', () => {
          const { lat, lng } = pin.getLngLat();
          move.current(lat, lng);
        });
        m.on('click', (event) => {
          pin.setLngLat(event.lngLat).addTo(m);
          move.current(event.lngLat.lat, event.lngLat.lng);
        });
        map.current = { setCenter: (c) => m.flyTo({ center: c, zoom: 17 }) };
        marker.current = {
          setLngLat: (c) => {
            pin.setLngLat(c).addTo(m);
          },
        };
        remove = () => m.remove();
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      remove?.();
    };
  }, []);

  // A point from the search (not from the pin itself) moves the pin and the view there.
  const key = point ? `${point.lat.toFixed(6)},${point.lng.toFixed(6)}` : '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `point`.
  useEffect(() => {
    if (!point) return;
    marker.current?.setLngLat([point.lng, point.lat]);
    map.current?.setCenter([point.lng, point.lat]);
  }, [key]);

  if (failed) {
    return <p className="muted">The map could not load here. Enter the coordinates below.</p>;
  }
  return <div ref={container} className="location-map" aria-hidden="true" />;
}

/**
 * The property's address and location: search fills the fields and drops the pin; the pin can be
 * dragged onto the entrance, which is where guests' walking distances start.
 */
export function AddressFields({
  value,
  onChange,
  parts = 'all',
}: {
  value: AddressValue;
  onChange: (next: AddressValue) => void;
  /** The setup wizard asks for the address and the map location as two questions. */
  parts?: 'all' | 'address' | 'map';
}) {
  const address = parts !== 'map';
  const map = parts !== 'address';
  const [search, setSearch] = useState('');
  const [cityText, setCityText] = useState(value.city ?? '');
  // What the host is typing into City; empty once they pick a suggestion or leave it as is.
  const [cityQuery, setCityQuery] = useState('');
  const [manual, setManual] = useState(false);
  const point =
    value.lat !== null && value.lng !== null ? { lat: value.lat, lng: value.lng } : null;
  const addresses = useGeoSearch(search, 'address', point);
  const cities = useGeoSearch(cityQuery, 'settlement', point);
  const countryId = useId();
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => setCityText(value.city ?? ''), [value.city]);

  const pickAddress = (place: GeoPlace) => {
    const number = houseNumberOf(search);
    const line =
      place.addressLine && number && !place.addressLine.includes(number)
        ? `${place.addressLine} ${number}`
        : place.addressLine;
    onChange({
      ...value,
      addressLine: line ?? value.addressLine,
      postalCode: place.postalCode ?? value.postalCode,
      city: place.city ?? value.city,
      country: place.country ?? value.country,
      lat: place.lat,
      lng: place.lng,
    });
    setSearch('');
  };

  const pinMoved = (lat: number, lng: number) => {
    onChange({ ...latest.current, lat, lng });
    // Fills only what is still empty; what the host typed stays.
    host.reverseGeocode(lat, lng).then(
      ({ place }) => {
        const now = latest.current;
        if (!place) return;
        onChange({
          ...now,
          postalCode: now.postalCode ?? place.postalCode,
          city: now.city ?? place.city,
        });
      },
      () => {},
    );
  };

  const options = (places: GeoPlace[]) =>
    places.map((p, i) => ({ ...p, id: `${i}:${p.label}`, label: p.label }));

  return (
    <div className="address-fields">
      {address ? (
        <>
          <SearchField
            label="Find the address"
            hint="Type the street and number, then pick it. It fills in the fields below and places the pin."
            placeholder="For example Gospe kraj mora 13, Trogir"
            value={search}
            onText={setSearch}
            options={options(addresses.places)}
            loading={addresses.loading}
            message={
              addresses.failed
                ? 'Search is not available right now. Fill in the fields and place the pin by hand.'
                : search.trim().length >= 3
                  ? 'No matching address. Try the street name only.'
                  : null
            }
            onPick={pickAddress}
          />
          <TextField
            label="Street address"
            value={value.addressLine}
            maxLength={LIMITS.shortText}
            onChange={(addressLine) => onChange({ ...value, addressLine })}
          />
          <div className="field-row">
            <TextField
              label="Postal code"
              value={value.postalCode}
              maxLength={LIMITS.shortText}
              onChange={(postalCode) => onChange({ ...value, postalCode })}
            />
            <SearchField
              label="City"
              icon={false}
              value={cityText}
              maxLength={LIMITS.shortText}
              onText={(text) => {
                setCityText(text);
                setCityQuery(text);
                onChange({ ...value, city: text.trim() === '' ? null : text });
              }}
              options={options(cities.places)}
              loading={cities.loading}
              onPick={(place) => {
                setCityQuery('');
                setCityText(place.city ?? place.label);
                onChange({
                  ...value,
                  city: place.city ?? place.label,
                  postalCode: value.postalCode ?? place.postalCode,
                  country: place.country ?? value.country,
                });
              }}
            />
          </div>
          {value.country !== undefined ? (
            <div className="field">
              <label className="field-label" htmlFor={countryId}>
                Country
              </label>
              <select
                id={countryId}
                value={value.country}
                onChange={(e) => onChange({ ...value, country: e.target.value })}
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </>
      ) : null}
      {map ? (
        <>
          <div className="field">
            <span className="field-label with-icon">
              <MapPin aria-hidden="true" />
              Location on the map
            </span>
            <LocationMap point={point} onMove={pinMoved} />
            <small>
              {point
                ? 'Drag the pin onto your entrance. Walking distances for guests start here.'
                : 'Find the address above, or click the map where your building is.'}
            </small>
            <button type="button" className="link-button" onClick={() => setManual(!manual)}>
              {manual ? 'Hide coordinates' : 'Enter coordinates by hand'}
            </button>
          </div>
          {manual ? (
            <div className="field-row">
              <NumberField
                label="Latitude"
                value={value.lat}
                min={-90}
                max={90}
                step="any"
                onChange={(lat) => onChange({ ...value, lat })}
              />
              <NumberField
                label="Longitude"
                value={value.lng}
                min={-180}
                max={180}
                step="any"
                onChange={(lng) => onChange({ ...value, lng })}
              />
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
