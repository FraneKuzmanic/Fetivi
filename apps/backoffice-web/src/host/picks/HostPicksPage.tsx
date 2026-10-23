import { HOST_PLACE_LIMITS } from '@fetivi/domain/host-picks-vocabulary';
import { MapPinPlus, Star } from '@phosphor-icons/react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  type HostAddedView,
  type HostPicks,
  type HostPickView,
  type HostPlaceTranslation,
  host,
  type PropertyDetail,
} from '../../api';
import { Section, TextArea } from '../../forms/fields';
import { PLACE_CATEGORY_LABELS, TRANSLATION_ERROR_LABELS } from '../../forms/labels';
import { useAction } from '../../useAction';
import { BlockList, preview } from '../BlockList';
import { TranslationChip } from '../translations/TranslationChip';
import { usePendingRefresh } from '../translations/usePendingRefresh';
import { AddedPlaceForm } from './AddedPlaceForm';
import { PickSearch, placeKindLabel } from './PickSearch';

type Update = (picks: HostPicks) => void;

/** The failed translation's reason and Retry, under a pick or an added place. */
function TranslationFailure({
  id,
  translation,
  onChanged,
}: {
  id: string;
  translation: HostPlaceTranslation;
  onChanged: Update;
}) {
  const { busy, error, run } = useAction();
  if (translation.status !== 'failed') return null;
  return (
    <span className="translation-error">
      {translation.error ? TRANSLATION_ERROR_LABELS[translation.error] : null}{' '}
      <button
        type="button"
        disabled={busy}
        onClick={() => void run(async () => onChanged(await host.retryHostPlaceTranslation(id)))}
      >
        Retry translation
      </button>
      {error ? <span role="alert"> {error}</span> : null}
    </span>
  );
}

function RemoveButton({
  label,
  id,
  onRemoved,
}: {
  label: string;
  id: string;
  onRemoved: () => Promise<void>;
}) {
  const { busy, error, run } = useAction();
  return (
    <>
      <button
        type="button"
        className="danger"
        disabled={busy}
        onClick={() => {
          if (window.confirm(`Remove ${label}? Your guests will no longer see it.`)) {
            void run(async () => {
              await host.deleteHostPlace(id);
              await onRemoved();
            });
          }
        }}
      >
        Remove<span className="visually-hidden"> {label}</span>
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </>
  );
}

function PickRow({
  pick,
  onChanged,
  reload,
}: {
  pick: HostPickView;
  onChanged: Update;
  reload: () => Promise<void>;
}) {
  const { busy, error, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState<string | null>(pick.note);

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      onChanged(await host.updateHostPlace(pick.id, { note }));
      setEditing(false);
    });
  }

  return (
    <li className="block-row">
      <span className="block-text">
        <span className="eyebrow">{placeKindLabel(pick)}</span>
        <span className="block-title">
          <strong>{pick.title}</strong>
          {pick.note ? <TranslationChip status={pick.translation.status} /> : null}
        </span>
        <span className="muted">{pick.note ? preview(pick.note) : 'No note'}</span>
        <TranslationFailure id={pick.id} translation={pick.translation} onChanged={onChanged} />
      </span>
      {editing ? null : (
        <span className="actions">
          <button
            type="button"
            onClick={() => {
              setNote(pick.note);
              setEditing(true);
            }}
          >
            Edit note<span className="visually-hidden"> ({pick.title})</span>
          </button>
          <RemoveButton label={pick.title} id={pick.id} onRemoved={reload} />
        </span>
      )}
      {editing ? (
        <form className="pick-note" onSubmit={submit}>
          <TextArea
            label={`Your note on ${pick.title}`}
            hint="Leave it empty for the badge alone."
            value={note}
            maxLength={HOST_PLACE_LIMITS.note}
            rows={3}
            onChange={setNote}
          />
          {error ? <p role="alert">{error}</p> : null}
          <div className="actions">
            <button type="submit" className="primary" disabled={busy}>
              Save note
            </button>
            <button type="button" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </li>
  );
}

function AddedRow({
  place,
  onChanged,
  reload,
}: {
  place: HostAddedView;
  onChanged: Update;
  reload: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <li>
        <AddedPlaceForm
          initial={place}
          heading={`Edit ${place.name}`}
          submitLabel="Save place"
          onSubmit={async (input) => {
            onChanged(await host.updateHostPlace(place.id, input));
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }
  return (
    <li className="block-row">
      <span className="block-text">
        <span className="eyebrow">{PLACE_CATEGORY_LABELS[place.placeCategory]}</span>
        <span className="block-title">
          <strong>{place.name}</strong>
          {place.inCatalog ? (
            <span className="chip ok">In Fetivi's catalog</span>
          ) : (
            <span className="chip neutral">Only your guests</span>
          )}
          <TranslationChip status={place.translation.status} />
        </span>
        {place.address ? <span className="muted">{place.address}</span> : null}
        <span className="muted">{preview(place.note)}</span>
        <TranslationFailure id={place.id} translation={place.translation} onChanged={onChanged} />
      </span>
      <span className="actions">
        <button type="button" onClick={() => setEditing(true)}>
          Edit<span className="visually-hidden"> {place.name}</span>
        </button>
        <RemoveButton label={place.name} id={place.id} onRemoved={reload} />
      </span>
    </li>
  );
}

/** /properties/:id/picks: the host's picks, places they added and Neighbourhood tips (40). */
export function HostPicksPage() {
  const { id = '' } = useParams();
  const { error, run } = useAction();
  const [detail, setDetail] = useState<PropertyDetail | null>(null);
  const [picks, setPicks] = useState<HostPicks | null>(null);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);

  const reloadPicks = useCallback(async () => setPicks(await host.picks(id)), [id]);
  const reloadBlocks = useCallback(async () => setDetail(await host.property(id)), [id]);

  useEffect(() => {
    void run(async () => {
      const [property, list] = await Promise.all([host.property(id), host.picks(id)]);
      setDetail(property);
      setPicks(list);
    });
  }, [id, run]);

  usePendingRefresh([...(picks?.picks ?? []), ...(picks?.added ?? [])], reloadPicks);
  usePendingRefresh(detail?.blocks ?? [], reloadBlocks);

  if (!detail || !picks) {
    return error ? <p role="alert">{error}</p> : <p className="muted">Loading…</p>;
  }
  const { destination } = picks;
  const tips = detail.blocks.filter((b) => b.category === 'host_picks');
  const full = picks.picks.length + picks.added.length >= HOST_PLACE_LIMITS.perProperty;

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/">Properties</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/properties/${id}`}>{detail.name}</Link>
      </nav>
      <div className="page-head">
        <h1>Host picks and tips</h1>
      </div>
      {error ? <p role="alert">{error}</p> : null}

      <div className="editor">
        {destination ? (
          <>
            <Section
              title="Your picks"
              description={`Places from Fetivi's checked catalog in ${destination.name}. Guests see them with a "Your host's pick" badge.`}
            >
              {picks.picks.length > 0 ? (
                <ul className="rows" aria-label="Your picks">
                  {picks.picks.map((p) => (
                    <PickRow key={p.id} pick={p} onChanged={setPicks} reload={reloadPicks} />
                  ))}
                </ul>
              ) : (
                <p className="muted">No picks yet.</p>
              )}
              {searching ? (
                <PickSearch
                  propertyId={id}
                  onPicked={(list) => {
                    setPicks(list);
                    setSearching(false);
                  }}
                  onClose={() => setSearching(false)}
                />
              ) : (
                <div>
                  <button type="button" disabled={full} onClick={() => setSearching(true)}>
                    <Star aria-hidden="true" />
                    Add a pick
                  </button>
                </div>
              )}
            </Section>

            <Section
              title="Places you added"
              description="A place Fetivi doesn't know yet. Your guests see it straight away, marked as added by you; Fetivi checks it before adding it to the catalog."
            >
              {picks.added.length > 0 ? (
                <ul className="rows" aria-label="Places you added">
                  {picks.added.map((p) => (
                    <AddedRow key={p.id} place={p} onChanged={setPicks} reload={reloadPicks} />
                  ))}
                </ul>
              ) : null}
              {adding ? (
                <AddedPlaceForm
                  heading="Add a place"
                  submitLabel="Add place"
                  onSubmit={async (input) => {
                    setPicks(await host.createAddedPlace(id, input));
                    setAdding(false);
                  }}
                  onCancel={() => setAdding(false)}
                />
              ) : (
                <div>
                  <button type="button" disabled={full} onClick={() => setAdding(true)}>
                    <MapPinPlus aria-hidden="true" />
                    Add a place
                  </button>
                </div>
              )}
              {full ? (
                <p className="muted">
                  You share {HOST_PLACE_LIMITS.perProperty} places, the most a property can have.
                  Remove one to add another.
                </p>
              ) : null}
            </Section>
          </>
        ) : (
          <section className="panel">
            <p className="muted">
              Your property isn't inside a Fetivi destination yet, so there are no catalog places to
              pick. Neighbourhood tips still reach your guests.
            </p>
          </section>
        )}

        <Section
          title="Neighbourhood tips"
          description="Shown in the guest Guide under Host's top picks, in each guest's language."
        >
          <BlockList
            blocks={tips}
            category="host_picks"
            create={(input) => host.createPropertyBlock(id, input)}
            onChanged={reloadBlocks}
            emptyText="No tips yet. Where do you eat, swim, buy bread?"
          />
        </Section>
      </div>
    </>
  );
}
