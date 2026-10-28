import type { GeoPlace } from '@fetivi/domain/geocode-vocabulary';
import { LIMITS } from '@fetivi/domain/vocabulary';
import { useEffect, useId, useRef, useState } from 'react';
import { geo } from '../../api';
import { countryOptions } from '../../forms/countries';
import { TextField } from '../../forms/fields';
import { MapPicker, placeOptions, useGeoSearch } from '../../forms/MapPicker';
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

const COUNTRIES = countryOptions();

/** The house number the host typed, kept when the picked result is only the street. */
function houseNumberOf(text: string): string | null {
  return /\b(\d+[a-zA-Z]?)\b/.exec(text)?.[1] ?? null;
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
    // Fills only what is still empty; what the host typed stays.
    geo.reverse(lat, lng).then(
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
            options={placeOptions(addresses.places)}
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
              options={placeOptions(cities.places)}
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
        <MapPicker
          label="Location on the map"
          value={{ lat: value.lat, lng: value.lng }}
          onChange={(p) => onChange({ ...latest.current, ...p })}
          onPinMoved={pinMoved}
          hint={
            point
              ? 'Drag the pin onto your entrance. Walking distances for guests start here.'
              : 'Find the address above, or click the map where your building is.'
          }
        />
      ) : null}
    </div>
  );
}
