import { HOST_PLACE_LIMITS } from '@fetivi/domain/host-picks-vocabulary';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type CatalogPlaceOption, type HostPicks, host } from '../../api';
import { TextArea, TextField } from '../../forms/fields';
import { currentLabels } from '../../i18n/useLabels';
import { useAction } from '../../useAction';

const DEBOUNCE_MS = 250;

/** A catalog place's category, or "Day trip". */
export const placeKindLabel = (p: Pick<CatalogPlaceOption, 'kind' | 'placeCategory'>) =>
  p.placeCategory
    ? currentLabels().placeCategory[p.placeCategory]
    : currentLabels().catalogKind[p.kind];

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
  const { t } = useTranslation(['host', 'common']);
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
      <h3>{t('picks.addPick')}</h3>
      <TextField
        label={t('picks.search')}
        placeholder={t('picks.searchPlaceholder')}
        value={query}
        maxLength={80}
        onChange={(q) => {
          setQuery(q);
          setChoosing(null);
        }}
      />
      {search.error ? <p role="alert">{search.error}</p> : null}
      {places?.length === 0 ? <p className="muted">{t('picks.noMatch')}</p> : null}
      {places && places.length > 0 ? (
        <ul className="rows" aria-label={t('picks.catalogPlaces')}>
          {places.map((p) => (
            <li key={p.id} className="block-row">
              <span className="block-text">
                <strong>{p.title}</strong>
                <span className="muted">
                  {[placeKindLabel(p), p.address].filter(Boolean).join(' · ')}
                </span>
              </span>
              {p.picked ? (
                <span className="chip neutral">{t('picks.alreadyPicked')}</span>
              ) : choosing === p.id ? null : (
                <button
                  type="button"
                  onClick={() => {
                    setChoosing(p.id);
                    setNote(null);
                  }}
                >
                  {t('picks.pick')}
                  <span className="visually-hidden"> {p.title}</span>
                </button>
              )}
              {choosing === p.id ? (
                <form className="pick-note" onSubmit={(e) => submit(e, p.id)}>
                  <TextArea
                    label={t('picks.noteOptional')}
                    hint={t('picks.noteOptionalHint')}
                    value={note}
                    maxLength={HOST_PLACE_LIMITS.note}
                    rows={3}
                    onChange={setNote}
                  />
                  {save.error ? <p role="alert">{save.error}</p> : null}
                  <div className="actions">
                    <button type="submit" className="primary" disabled={save.busy}>
                      {t('picks.savePick')}
                    </button>
                    <button type="button" onClick={() => setChoosing(null)}>
                      {t('common:cancel')}
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
          {t('picks.done')}
        </button>
      </div>
    </div>
  );
}
