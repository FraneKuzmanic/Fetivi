import { PLACE_CATEGORIES, type PlaceCategory } from '@fetivi/domain/catalog-vocabulary';
import { HOST_PLACE_LIMITS } from '@fetivi/domain/host-picks-vocabulary';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, type HostAddedPlaceInput, type HostAddedView } from '../../api';
import { SelectField, TextArea, TextField } from '../../forms/fields';
import { MapPicker, noLocation } from '../../forms/MapPicker';
import { useLabels } from '../../i18n/useLabels';
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
  const { t } = useTranslation(['host', 'common']);
  const labels = useLabels();
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
      if (lat === null || lng === null) throw new Error(noLocation());
      try {
        await onSubmit({
          name: name ?? '',
          // The browser refuses to submit an empty required field, so this is set.
          placeCategory: category as PlaceCategory,
          location: { lat, lng },
          address,
          note: note ?? '',
        });
      } catch (e) {
        if (e instanceof ApiError && e.code === 'outside-destination') setOutside(true);
        throw e;
      }
    });
  }

  const message = error && outside ? t('picks.outside', { destination: destinationName }) : error;

  return (
    <form className="block-editor" aria-label={heading} onSubmit={submit}>
      <h3>{heading}</h3>
      <div className="fields">
        <TextField
          label={t('picks.name')}
          value={name}
          maxLength={HOST_PLACE_LIMITS.name}
          required
          onChange={setName}
        />
        <SelectField
          label={t('picks.category')}
          value={category}
          options={PLACE_CATEGORIES}
          labels={labels.placeCategory}
          emptyLabel={t('picks.chooseCategory')}
          required
          onChange={setCategory}
        />
        <MapPicker
          label={t('picks.mapLocation')}
          value={{ lat, lng }}
          onChange={(p) => {
            setLat(p.lat);
            setLng(p.lng);
          }}
          search={{
            label: t('picks.findPlace'),
            placeholder: t('picks.nameOrAddress'),
            kind: 'address',
            onPick: (place) => setAddress((now) => now ?? place.addressLine ?? place.label),
          }}
          required
        />
        <TextField
          label={t('picks.address')}
          value={address}
          maxLength={HOST_PLACE_LIMITS.address}
          onChange={setAddress}
        />
        <TextArea
          label={t('picks.why')}
          hint={t('picks.whyHint')}
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
          {t('common:cancel')}
        </button>
      </div>
    </form>
  );
}
