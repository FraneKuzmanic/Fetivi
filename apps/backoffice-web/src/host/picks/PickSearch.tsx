import { HOST_PLACE_LIMITS } from '@fetivi/domain/host-picks-vocabulary';
import { type FormEvent, useEffect, useState } from 'react';
import { type CatalogPlaceOption, type HostPicks, host } from '../../api';
import { TextArea, TextField } from '../../forms/fields';
import { CATALOG_KIND_LABELS, PLACE_CATEGORY_LABELS } from '../../forms/labels';
import { useAction } from '../../useAction';

const DEBOUNCE_MS = 250;

/** A catalog place's category, or "Day trip". */
export const placeKindLabel = (p: Pick<CatalogPlaceOption, 'kind' | 'placeCategory'>) =>
  p.placeCategory ? PLACE_CATEGORY_LABELS[p.placeCategory] : CATALOG_KIND_LABELS[p.kind];

/** Searches the destination's published catalog places; Pick asks for an optional note. */
export function PickSearch({
  propertyId,
  onPicked,
  onClose,
}: {
  propertyId: string;
  onPicked: (picks: HostPicks) => void;
  onClose: () => void;
}) {
  const search = useAction();
  const save = useAction();
  const [query, setQuery] = useState<string | null>(null);
  const [places, setPlaces] = useState<CatalogPlaceOption[] | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const { run } = search;

  useEffect(() => {
    const timer = setTimeout(() => {
      void run(async () => {
        setPlaces((await host.catalogPlaces(propertyId, query?.trim() ?? '')).places);
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [propertyId, query, run]);

  function submit(event: FormEvent, recordId: string) {
    event.preventDefault();
    void save.run(async () => {
      onPicked(await host.createPick(propertyId, { recordId, note }));
    });
  }

  return (
    <div className="block-editor">
      <h3>Add a pick</h3>
      <TextField
        label="Search Fetivi's places"
        placeholder="Beach, konoba, Krka…"
        value={query}
        maxLength={80}
        onChange={(q) => {
          setQuery(q);
          setChoosing(null);
        }}
      />
      {search.error ? <p role="alert">{search.error}</p> : null}
      {places?.length === 0 ? <p className="muted">No places match.</p> : null}
      {places && places.length > 0 ? (
        <ul className="rows" aria-label="Catalog places">
          {places.map((p) => (
            <li key={p.id} className="block-row">
              <span className="block-text">
                <strong>{p.title}</strong>
                <span className="muted">
                  {[placeKindLabel(p), p.address].filter(Boolean).join(' · ')}
                </span>
              </span>
              {p.picked ? (
                <span className="chip neutral">Already picked</span>
              ) : choosing === p.id ? null : (
                <button
                  type="button"
                  onClick={() => {
                    setChoosing(p.id);
                    setNote(null);
                  }}
                >
                  Pick<span className="visually-hidden"> {p.title}</span>
                </button>
              )}
              {choosing === p.id ? (
                <form className="pick-note" onSubmit={(e) => submit(e, p.id)}>
                  <TextArea
                    label="Your note (optional)"
                    hint="Why you recommend it. Guests read it in their language."
                    value={note}
                    maxLength={HOST_PLACE_LIMITS.note}
                    rows={3}
                    onChange={setNote}
                  />
                  {save.error ? <p role="alert">{save.error}</p> : null}
                  <div className="actions">
                    <button type="submit" className="primary" disabled={save.busy}>
                      Save pick
                    </button>
                    <button type="button" onClick={() => setChoosing(null)}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="actions">
        <button type="button" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
