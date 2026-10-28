import { HOST_PLACE_LIMITS } from '@fetivi/domain/host-picks-vocabulary';
import { MapPinPlus, PencilSimple, Star, Trash } from '@phosphor-icons/react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { useLabels } from '../../i18n/useLabels';
import { useConfirm } from '../../shell/ConfirmDialog';
import { usePageTitle } from '../../shell/PageTitle';
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
  const { t } = useTranslation(['host', 'common']);
  const labels = useLabels();
  const { busy, error, run } = useAction();
  if (translation.status !== 'failed') return null;
  return (
    <span className="translation-error">
      {translation.error ? labels.translationError[translation.error] : null}{' '}
      <button
        type="button"
        disabled={busy}
        onClick={() => void run(async () => onChanged(await host.retryHostPlaceTranslation(id)))}
      >
        {t('blocks.retryTranslation')}
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
  const { t } = useTranslation(['host', 'common']);
  const { busy, error, run } = useAction();
  const confirm = useConfirm();
  return (
    <>
      <button
        type="button"
        className="ghost icon-button remove-button"
        aria-label={t('picks.removeAria', { label })}
        title={t('common:remove')}
        disabled={busy}
        onClick={async () => {
          if (
            await confirm({
              title: t('picks.removeTitle', { label }),
              body: t('picks.removeBody'),
              action: t('common:remove'),
              danger: true,
            })
          ) {
            void run(async () => {
              await host.deleteHostPlace(id);
              await onRemoved();
            });
          }
        }}
      >
        <Trash aria-hidden="true" />
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
  const { t } = useTranslation(['host', 'common']);
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
    <li className="block-row entry-row">
      <span className="block-text">
        <span className="block-title">
          <strong>{pick.title}</strong>
          {pick.note ? <TranslationChip status={pick.translation.status} /> : null}
        </span>
        <span className="muted">{pick.note ? preview(pick.note) : t('picks.noNote')}</span>
        <span className="entry-meta">{placeKindLabel(pick)}</span>
        <TranslationFailure id={pick.id} translation={pick.translation} onChanged={onChanged} />
      </span>
      {editing ? null : (
        <span className="entry-actions">
          <button
            type="button"
            onClick={() => {
              setNote(pick.note);
              setEditing(true);
            }}
          >
            <PencilSimple aria-hidden="true" />
            {t('picks.editNote')}
            <span className="visually-hidden"> ({pick.title})</span>
          </button>
          <RemoveButton label={pick.title} id={pick.id} onRemoved={reload} />
        </span>
      )}
      {editing ? (
        <form className="pick-note" onSubmit={submit}>
          <TextArea
            label={t('picks.noteOn', { title: pick.title })}
            hint={t('picks.noteHint')}
            value={note}
            maxLength={HOST_PLACE_LIMITS.note}
            rows={3}
            onChange={setNote}
          />
          {error ? <p role="alert">{error}</p> : null}
          <div className="actions">
            <button type="submit" className="primary" disabled={busy}>
              {t('picks.saveNote')}
            </button>
            <button type="button" disabled={busy} onClick={() => setEditing(false)}>
              {t('common:cancel')}
            </button>
          </div>
        </form>
      ) : null}
    </li>
  );
}

function AddedRow({
  place,
  destinationName,
  onChanged,
  reload,
}: {
  place: HostAddedView;
  destinationName: string;
  onChanged: Update;
  reload: () => Promise<void>;
}) {
  const { t } = useTranslation(['host', 'common']);
  const labels = useLabels();
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <li>
        <AddedPlaceForm
          initial={place}
          heading={t('picks.editPlace', { name: place.name })}
          submitLabel={t('picks.savePlace')}
          destinationName={destinationName}
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
    <li className="block-row entry-row">
      <span className="block-text">
        <span className="block-title">
          <strong>{place.name}</strong>
          {place.inCatalog ? (
            <span className="chip ok">{t('picks.inCatalog')}</span>
          ) : (
            <span className="chip neutral">{t('picks.onlyYours')}</span>
          )}
          <TranslationChip status={place.translation.status} />
        </span>
        <span className="muted entry-preview">{preview(place.note)}</span>
        <span className="entry-meta">
          {[labels.placeCategory[place.placeCategory], place.address].filter(Boolean).join(' · ')}
        </span>
        <TranslationFailure id={place.id} translation={place.translation} onChanged={onChanged} />
      </span>
      <span className="entry-actions">
        <button type="button" onClick={() => setEditing(true)}>
          <PencilSimple aria-hidden="true" />
          {t('common:edit')}
          <span className="visually-hidden"> {place.name}</span>
        </button>
        <RemoveButton label={place.name} id={place.id} onRemoved={reload} />
      </span>
    </li>
  );
}

/** /properties/:id/picks: the host's picks, places they added and Neighbourhood tips (40). */
export function HostPicksPage() {
  const { t } = useTranslation(['host', 'common']);
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

  usePageTitle(t('picks.title'));

  if (!detail || !picks) {
    return error ? <p role="alert">{error}</p> : <p className="muted">{t('common:loading')}</p>;
  }
  const { destination } = picks;
  const tips = detail.blocks.filter((b) => b.category === 'host_picks');
  const full = picks.picks.length + picks.added.length >= HOST_PLACE_LIMITS.perProperty;

  return (
    <>
      <nav className="crumbs" aria-label={t('common:page.breadcrumb')}>
        <Link to="/properties">{t('properties.title')}</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/properties/${id}`}>{detail.name}</Link>
      </nav>
      {error ? <p role="alert">{error}</p> : null}

      <div className="editor">
        {destination ? (
          <>
            <Section
              title={t('picks.yourPicks')}
              description={t('picks.yourPicksHint', { destination: destination.name })}
            >
              {picks.picks.length > 0 ? (
                <ul className="rows" aria-label={t('picks.yourPicks')}>
                  {picks.picks.map((p) => (
                    <PickRow key={p.id} pick={p} onChanged={setPicks} reload={reloadPicks} />
                  ))}
                </ul>
              ) : (
                <p className="muted">{t('picks.noPicks')}</p>
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
                    {t('picks.addPick')}
                  </button>
                </div>
              )}
            </Section>

            <Section title={t('picks.added')} description={t('picks.addedHint')}>
              {picks.added.length > 0 ? (
                <ul className="rows" aria-label={t('picks.added')}>
                  {picks.added.map((p) => (
                    <AddedRow
                      key={p.id}
                      place={p}
                      destinationName={destination.name}
                      onChanged={setPicks}
                      reload={reloadPicks}
                    />
                  ))}
                </ul>
              ) : null}
              {adding ? (
                <AddedPlaceForm
                  heading={t('picks.addPlace')}
                  submitLabel={t('picks.addPlaceButton')}
                  destinationName={destination.name}
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
                    {t('picks.addPlace')}
                  </button>
                </div>
              )}
              {full ? (
                <p className="muted">{t('picks.full', { limit: HOST_PLACE_LIMITS.perProperty })}</p>
              ) : null}
            </Section>
          </>
        ) : (
          <section className="panel">
            <p className="muted">{t('picks.noDestination')}</p>
          </section>
        )}

        <Section title={t('picks.tips')} description={t('picks.tipsHint')}>
          <BlockList
            blocks={tips}
            category="host_picks"
            create={(input) => host.createPropertyBlock(id, input)}
            onChanged={reloadBlocks}
            emptyText={t('picks.tipsEmpty')}
          />
        </Section>
      </div>
    </>
  );
}
