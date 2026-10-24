import { PLACE_CATEGORIES, type PlaceCategory } from '@fetivi/domain/catalog-vocabulary';
import { HOST_PLACE_LIMITS } from '@fetivi/domain/host-picks-vocabulary';
import { type FormEvent, useState } from 'react';
import { ApiError, type HostAddedPlaceInput, type HostAddedView } from '../../api';
import { NumberField, SelectField, TextArea, TextField } from '../../forms/fields';
import { PLACE_CATEGORY_LABELS } from '../../forms/labels';
import { useAction } from '../../useAction';

/** Adds a place that is not in the catalog, or edits one the host added. */
export function AddedPlaceForm({
  initial,
  heading,
  submitLabel,
  destinationName,
  onSubmit,
  onCancel,
}: {
  initial?: HostAddedView;
  heading: string;
  submitLabel: string;
  destinationName: string;
  onSubmit: (input: HostAddedPlaceInput) => Promise<void>;
  onCancel: () => void;
}) {
  const { busy, error, run } = useAction();
  const [name, setName] = useState<string | null>(initial?.name ?? null);
  const [category, setCategory] = useState<PlaceCategory | null>(initial?.placeCategory ?? null);
  const [lat, setLat] = useState<number | null>(initial?.location.lat ?? null);
  const [lng, setLng] = useState<number | null>(initial?.location.lng ?? null);
  const [address, setAddress] = useState<string | null>(initial?.address ?? null);
  const [note, setNote] = useState<string | null>(initial?.note ?? null);
  // The shared message can't name the destination, so this form words that one itself.
  const [outside, setOutside] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      setOutside(false);
      try {
        await onSubmit({
          name: name ?? '',
          // The browser refuses to submit an empty required field, so these are set.
          placeCategory: category as PlaceCategory,
          location: { lat: lat as number, lng: lng as number },
          address,
          note: note ?? '',
        });
      } catch (e) {
        if (e instanceof ApiError && e.code === 'outside-destination') setOutside(true);
        throw e;
      }
    });
  }

  const message =
    error && outside
      ? `That spot is outside ${destinationName}, your property's destination. Pick a place in the same area as your property.`
      : error;

  return (
    <form className="block-editor" aria-label={heading} onSubmit={submit}>
      <h3>{heading}</h3>
      <div className="fields">
        <TextField
          label="Name"
          value={name}
          maxLength={HOST_PLACE_LIMITS.name}
          required
          onChange={setName}
        />
        <SelectField
          label="Category"
          value={category}
          options={PLACE_CATEGORIES}
          labels={PLACE_CATEGORY_LABELS}
          emptyLabel="Choose a category"
          required
          onChange={setCategory}
        />
        <div className="field-row">
          <NumberField
            label="Latitude"
            value={lat}
            min={-90}
            max={90}
            step="any"
            placeholder="43.5170"
            required
            onChange={setLat}
          />
          <NumberField
            label="Longitude"
            value={lng}
            min={-180}
            max={180}
            step="any"
            placeholder="16.2514"
            required
            onChange={setLng}
          />
        </div>
        <TextField
          label="Address"
          value={address}
          maxLength={HOST_PLACE_LIMITS.address}
          onChange={setAddress}
        />
        <TextArea
          label="Why your guests should go"
          hint="Guests read it in their language, as your own words."
          value={note}
          maxLength={HOST_PLACE_LIMITS.note}
          rows={3}
          required
          onChange={setNote}
        />
      </div>
      {message ? <p role="alert">{message}</p> : null}
      <div className="actions">
        <button type="submit" className="primary" disabled={busy}>
          {submitLabel}
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
