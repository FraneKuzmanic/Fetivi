import type { PlaceCategory, SourceField } from '@fetivi/domain/catalog-vocabulary';
import {
  CURATED_TEXT_FIELDS,
  CURATION_KINDS,
  type CuratedChanges,
  type CurationAction,
  type CurationKind,
  type CurationTab,
  type DraftedHours,
  type DraftedSeason,
} from '@fetivi/domain/curation-vocabulary';
import type { FeedbackReason } from '@fetivi/domain/feedback-vocabulary';
import { ClockCounterClockwise, DotsThree, ListChecks } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ApiError, type CurationItem, catalog, curation, type Destination } from '../../api';
import { formatDate, formatDay } from '../../forms/datetime';
import { i18next, localeOf } from '../../i18n';
import { currentLabels, useLabels } from '../../i18n/useLabels';
import { useConfirm } from '../../shell/ConfirmDialog';
import { EmptyState } from '../../shell/EmptyState';
import { Menu } from '../../shell/Menu';
import { usePageTitle } from '../../shell/PageTitle';
import { Tabs } from '../../shell/Tabs';
import { useAction } from '../../useAction';

const t = i18next.getFixedT(null, 'admin', 'curation');

const tabs = (): { id: CurationTab; label: string; empty: [string, string] }[] => [
  { id: 'open', label: t('toReview'), empty: [t('caughtUp'), t('caughtUpBody')] },
  { id: 'needs_visit', label: t('needsVisit'), empty: [t('noVisit'), t('noVisitBody')] },
  { id: 'done', label: t('done'), empty: [t('noneDone'), t('noneDoneBody')] },
];

const KIND_TONE: Record<CurationKind, string> = {
  draft: 'neutral',
  refresh_diff: 'neutral',
  guest_flagged: 'fail',
  host_place_suggestion: 'wait',
  host_provider_suggestion: 'wait',
  fallback_topic_cluster: 'neutral',
};

const date = formatDay;

/** A YYYY-MM-DD day as written, whatever the viewer's zone. */
const calendarDay = formatDate;

const categoryLabel = (code: string) =>
  currentLabels().placeCategory[code as PlaceCategory] ?? code;

/** The row's one-line headline, per kind. */
function headline(item: CurationItem): string {
  const p = item.payload;
  switch (p.kind) {
    case 'host_place_suggestion':
      return t('nameCategory', { name: p.name, category: categoryLabel(p.placeCategory) });
    case 'host_provider_suggestion':
      return p.name;
    case 'fallback_topic_cluster':
      return t('cluster', {
        topic: p.topic,
        count: p.count,
        noResults: p.noResults,
        week: calendarDay(p.weekStart),
      });
    default:
      return item.record?.title ?? item.candidate?.name ?? t('recordRemoved');
  }
}

/** What the kind proposes or reports, in a few words. */
function detail(item: CurationItem): string | null {
  const p = item.payload;
  switch (p.kind) {
    case 'draft':
    case 'refresh_diff': {
      if (p.kind === 'draft' && !item.record && item.candidate && !item.drafted) {
        if (p.drafting?.status === 'no_sources') {
          return t('noSources');
        }
        if (p.drafting?.status === 'failed') return t('draftFailed');
        return p.drafting ? t('beingDrafted') : t('waitingDraft');
      }
      const fields = proposedFields(p.changes);
      if (fields.length === 0) return null;
      const names = fields
        .map((f) => currentLabels().sourceField[f as SourceField] ?? f)
        .join(', ');
      return p.kind === 'draft'
        ? t('proposes', { fields: names })
        : t('changed', { fields: names });
    }
    case 'guest_flagged':
      return t('flagged', {
        reason: (
          currentLabels().feedbackReason[p.reason as FeedbackReason] ?? p.reason
        ).toLowerCase(),
        count: p.count,
      });
    case 'fallback_topic_cluster':
      return [
        p.topics.length > 1 ? t('askedAs', { topics: p.topics.join(', ') }) : null,
        p.places.length > 0 ? t('near', { places: p.places.join(', ') }) : null,
      ]
        .filter(Boolean)
        .join(' · ');
    case 'host_place_suggestion':
      return [p.address, p.note].filter(Boolean).join(' · ') || null;
    case 'host_provider_suggestion':
      return [p.contact, p.note].filter(Boolean).join(' · ') || null;
  }
}

/** The record's field order; jsonb does not keep the order the job wrote. */
const FIELD_ORDER: readonly string[] = [...CURATED_TEXT_FIELDS, 'openingHours', 'seasons'];

/** The fields a draft or diff proposes, in the record's field order. */
const proposedFields = (changes: CuratedChanges) =>
  (Object.keys(changes).filter((f) => f !== 'fieldSources') as (keyof CuratedChanges)[]).sort(
    (a, b) => FIELD_ORDER.indexOf(a) - FIELD_ORDER.indexOf(b),
  );

const dayMonth = (month: number, day: number) =>
  new Date(Date.UTC(2000, month - 1, day)).toLocaleDateString(localeOf(i18next.language), {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

const hoursText = (hours: DraftedHours[]) =>
  hours
    .map((h) => {
      const dates =
        h.validFrom || h.validTo
          ? ` ${t('validRange', {
              from: h.validFrom ? calendarDay(h.validFrom) : '…',
              to: h.validTo ? calendarDay(h.validTo) : '…',
            })}`
          : '';
      return `${currentLabels().weekday[h.weekday]?.slice(0, 3) ?? h.weekday} ${h.opens}–${h.closes}${dates}`;
    })
    .join(', ');

const seasonsText = (seasons: DraftedSeason[]) =>
  seasons
    .map((s) => `${dayMonth(s.fromMonth, s.fromDay)} – ${dayMonth(s.toMonth, s.toDay)}`)
    .join(', ');

/** A proposed or previous value as plain text; never rendered as HTML. */
function valueText(changes: CuratedChanges, field: keyof CuratedChanges): string | null {
  const value = changes[field];
  if (value === undefined) return null;
  if (field === 'openingHours') return hoursText(value as DraftedHours[]) || t('none');
  if (field === 'seasons') return seasonsText(value as DraftedSeason[]) || t('none');
  return typeof value === 'string' ? value : null;
}

/** Only web links become links: a source URL came from a page, so it is checked again here. */
const isWebUrl = (url: string | null | undefined): url is string =>
  !!url && /^https?:\/\//i.test(url);

function SourceLink({ url }: { url: string | null | undefined }) {
  return isWebUrl(url) ? (
    <a className="proposal-source" href={url} target="_blank" rel="noreferrer noopener">
      {t('source')}
    </a>
  ) : null;
}

/** "Show proposal": each field a draft or diff proposes, with its source and previous value. */
function Proposal({ item }: { item: CurationItem }) {
  const labels = useLabels();
  const p = item.payload;
  if (p.kind !== 'draft' && p.kind !== 'refresh_diff') return null;
  if (p.kind === 'draft' && !item.record && !item.drafted) return null;
  const fields = proposedFields(p.changes);
  if (fields.length === 0) return null;
  const sources = p.changes.fieldSources ?? {};
  return (
    <details className="proposal">
      <summary>{t('showProposal')}</summary>
      <dl>
        {fields.map((field) => {
          const previous = p.kind === 'refresh_diff' ? valueText(p.previous, field) : null;
          return (
            <div key={field} className="proposal-field">
              <dt>{labels.sourceField[field as SourceField] ?? field}</dt>
              <dd>
                {p.kind === 'refresh_diff' ? (
                  previous === null ? (
                    <span className="muted">{t('wasEmpty')} </span>
                  ) : (
                    <>
                      <del>{previous}</del>{' '}
                    </>
                  )
                ) : null}
                <span>{valueText(p.changes, field)}</span> <SourceLink url={sources[field]} />
              </dd>
            </div>
          );
        })}
        {p.kind === 'draft' && p.place ? (
          <>
            <div className="proposal-field">
              <dt>{labels.sourceField.placeCategory}</dt>
              <dd>
                {categoryLabel(p.place.placeCategory)}{' '}
                <SourceLink url={p.place.categorySourceUrl} />
              </dd>
            </div>
            <div className="proposal-field">
              <dt>{labels.sourceField.location}</dt>
              <dd>
                {t('from', { source: labels.seedingSource[p.place.locationSource] })}{' '}
                <SourceLink url={p.place.locationSourceUrl} />
              </dd>
            </div>
          </>
        ) : null}
        {p.kind === 'draft'
          ? (p.images ?? []).map((image) => (
              <div key={image.url} className="proposal-field">
                <dt>{t('image')}</dt>
                <dd>
                  Wikimedia Commons, {image.attribution} · {image.licence}{' '}
                  <SourceLink url={image.sourcePageUrl} />
                </dd>
              </div>
            ))
          : null}
      </dl>
    </details>
  );
}

/** A short name for the item, for the status line after an action. */
function subject(item: CurationItem): string {
  const p = item.payload;
  if (p.kind === 'fallback_topic_cluster') return `“${p.topic}”`;
  if ('name' in p) return p.name;
  return item.record?.title ?? item.candidate?.name ?? t('theItem');
}

const doneText = (action: CurationAction, item: CurationItem): string | null =>
  action === 'approve'
    ? t('approved', { subject: subject(item) })
    : action === 'reject'
      ? t('rejected', { subject: subject(item) })
      : action === 'needs_visit'
        ? t('movedToVisit', { subject: subject(item) })
        : null;

function meta(item: CurationItem): string {
  return [
    item.destination?.name ?? t('noDestination'),
    item.host?.email,
    item.reviewedAt
      ? t('reviewed', { date: date(item.reviewedAt) })
      : t('added', { date: date(item.createdAt) }),
  ]
    .filter(Boolean)
    .join(' · ');
}

/** /admin/curation: the one queue of everything waiting for the admin's review. */
export function CurationPage() {
  const labels = useLabels();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [params] = useSearchParams();
  const { busy, error, run } = useAction();
  const [tab, setTab] = useState<CurationTab>('open');
  // ?kind=draft, as the Seeding screen links it.
  const [kind, setKind] = useState<CurationKind | null>(() => {
    const k = params.get('kind');
    return CURATION_KINDS.find((c) => c === k) ?? null;
  });
  const [destinationId, setDestinationId] = useState('');
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [items, setItems] = useState<CurationItem[] | null>(null);
  const [counts, setCounts] = useState<Record<CurationKind, number> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const query = useCallback(
    () =>
      curation.list({
        status: tab,
        kind: kind ?? undefined,
        destinationId: destinationId || undefined,
      }),
    [tab, kind, destinationId],
  );

  const load = useCallback(async () => {
    const result = await query();
    setItems(result.items);
    setCounts(result.counts);
  }, [query]);

  useEffect(() => {
    setItems(null);
    setNotice(null);
    void run(load);
  }, [run, load]);

  useEffect(() => {
    void run(async () => setDestinations((await catalog.destinations()).destinations));
  }, [run]);

  const act = async (item: CurationItem, action: CurationAction) => {
    if (action === 'reject') {
      const yes = await confirm({
        title: t('rejectTitle', { subject: subject(item) }),
        body: t('rejectBody'),
        action: t('reject'),
        danger: true,
      });
      if (!yes) return;
    }
    void run(async () => {
      setNotice(null);
      try {
        if (action === 'edit') {
          const { recordId } = await curation.edit(item.id);
          navigate(`/admin/catalog/records/${recordId}`);
          return;
        }
        if (action === 'approve') await curation.approve(item.id);
        if (action === 'reject') await curation.reject(item.id);
        if (action === 'needs_visit') await curation.needsVisit(item.id);
        setItems((rows) => rows?.filter((r) => r.id !== item.id) ?? null);
        setNotice(doneText(action, item));
        setCounts((await query()).counts);
      } catch (e) {
        // Another admin reviewed it first: show the list as it is now.
        if (e instanceof ApiError && e.status === 409) await load();
        throw e;
      }
    });
  };

  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : null;
  const [emptyTitle, emptyText] = tabs().find((x) => x.id === tab)?.empty ?? ['', ''];
  const filtered = kind !== null || destinationId !== '';

  usePageTitle(t('title'));

  return (
    <>
      <Tabs label={t('status')} items={tabs()} value={tab} onChange={setTab} />
      <div className="toolbar">
        <label className="field inline-field">
          <span className="field-label">{t('destination')}</span>
          <select value={destinationId} onChange={(e) => setDestinationId(e.target.value)}>
            <option value="">{t('allDestinations')}</option>
            {destinations.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field inline-field">
          <span className="field-label">{t('kind')}</span>
          <select
            value={kind ?? ''}
            onChange={(e) => setKind((e.target.value || null) as CurationKind | null)}
          >
            <option value="">{total ? t('allKindsCount', { count: total }) : t('allKinds')}</option>
            {CURATION_KINDS.map((k) => (
              <option key={k} value={k}>
                {counts?.[k]
                  ? t('withCount', { label: labels.curationKind[k], count: counts[k] })
                  : labels.curationKind[k]}
              </option>
            ))}
          </select>
        </label>
        <Link className="button toolbar-end" to="/admin/curation/staleness">
          <ClockCounterClockwise aria-hidden="true" />
          {t('due')}
        </Link>
      </div>
      {notice && !error ? (
        <output className="saved" aria-live="polite">
          {notice}
        </output>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {items === null && !error ? <p className="muted">{i18next.t('common:loading')}</p> : null}
      {items?.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={ListChecks}
            title={t('noMatch')}
            action={
              <button
                type="button"
                onClick={() => {
                  setKind(null);
                  setDestinationId('');
                }}
              >
                {t('showAll')}
              </button>
            }
          />
        ) : (
          <EmptyState icon={ListChecks} title={emptyTitle}>
            {emptyText}
          </EmptyState>
        )
      ) : null}
      {items && items.length > 0 ? (
        <ul className="rows">
          {items.map((item) => {
            const more = detail(item);
            const [first, ...rest] = item.actions;
            return (
              <li key={item.id} className="block-row curation-row">
                <div className="block-text">
                  <span className="block-title">
                    <span className={`chip ${KIND_TONE[item.kind]}`}>
                      {labels.curationKind[item.kind]}
                    </span>
                    <strong>{headline(item)}</strong>
                  </span>
                  {more ? <span className="muted">{more}</span> : null}
                  <span className="muted">{meta(item)}</span>
                  <Proposal item={item} />
                </div>
                {first ? (
                  <div className="actions queue-actions">
                    <button
                      type="button"
                      className={first === 'approve' ? 'primary' : undefined}
                      disabled={busy}
                      onClick={() => void act(item, first)}
                    >
                      {labels.curationAction[first]}
                    </button>
                    {rest.length > 0 ? (
                      <Menu
                        label={t('moreFor', { subject: subject(item) })}
                        trigger={<DotsThree aria-hidden="true" weight="bold" />}
                        items={rest.map((a) => ({
                          label: labels.curationAction[a],
                          danger: a === 'reject',
                          onSelect: () => void act(item, a),
                        }))}
                      />
                    ) : null}
                  </div>
                ) : (
                  <span className={`chip ${item.status === 'approved' ? 'ok' : 'neutral'}`}>
                    {labels.curationStatus[item.status]}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </>
  );
}
