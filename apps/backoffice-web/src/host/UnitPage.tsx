import { BED_TYPES, type HostBlockCategory, LIMITS } from '@fetivi/domain/vocabulary';
import {
  Bed,
  BookOpenText,
  CalendarCheck,
  CalendarDots,
  CaretRight,
  ChartBar,
  ClipboardText,
  Couch,
  DotsThree,
  DownloadSimple,
  EyeSlash,
  PencilSimple,
  Plus,
  Trash,
  WifiHigh,
} from '@phosphor-icons/react';
import { Fragment, useCallback, useEffect, useId, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  type Block,
  host,
  type SecretWarning,
  type UnitDetail,
  type UnitPatch,
  type WizardStatus,
} from '../api';
import { CheckboxField, NumberField, Section, SelectField, TextField } from '../forms/fields';
import { BED_LABELS, CATEGORY_LABELS } from '../forms/labels';
import { sectionBody } from '../forms/patch';
import { Menu } from '../shell/Menu';
import { useAction } from '../useAction';
import { AmenitiesEditor } from './AmenitiesEditor';
import { BlockEditor, SecretWarnings } from './BlockEditor';
import { BlockList, preview } from './BlockList';
import { CORE_SECTION_ICONS, CORE_SECTIONS, CoreField } from './CoreFields';
import { type PageSection, SectionLayout } from './SectionLayout';
import { CalendarsPanel } from './stays/proposed/CalendarsPanel';
import { FieldTranslationStatus } from './translations/FieldTranslationStatus';
import { TranslationChip } from './translations/TranslationChip';
import { usePendingRefresh } from './translations/usePendingRefresh';
import { CompletenessBar } from './wizard/CompletenessBar';
import { useWizardCopy } from './wizard/copy';
import { GoLivePanel, UNIT_BLOCKS_ID } from './wizard/GoLivePanel';

type Draft = Required<UnitPatch>;

const RELEASE_DAYS = [0, 1, 2, 3, 4, 5, 6, 7] as const;

export function releaseLabel(days: number): string {
  if (days === 0) return 'On the check-in day';
  return days === 1 ? '1 day before check-in' : `${days} days before check-in`;
}

export function UnitPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { busy, error, run } = useAction();
  const [detail, setDetail] = useState<UnitDetail | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [status, setStatus] = useState<WizardStatus | null>(null);

  const load = useCallback(
    () =>
      run(async () => {
        const [fresh, wizard] = await Promise.all([host.unit(id), host.wizard(id)]);
        setDetail(fresh);
        setDraft(fresh);
        setStatus(wizard);
      }),
    [id, run],
  );

  useEffect(() => {
    void load();
  }, [load]);

  usePendingRefresh(
    [
      ...(detail?.blocks ?? []),
      ...(detail?.propertyBlocks ?? []),
      ...(detail?.fieldTranslations ?? []).map((f) => ({ translation: { status: f.status } })),
    ],
    async () => setDetail(await host.unit(id)),
  );

  if (!detail || !draft) {
    return error ? <p role="alert">{error}</p> : <p className="muted">Loading…</p>;
  }

  const set =
    <K extends keyof Draft>(key: K) =>
    (value: Draft[K]) =>
      setDraft((d) => (d ? { ...d, [key]: value } : d));

  const saveFields = (keys: readonly (keyof Draft)[]) => async () => {
    const saved = await host.updateUnit(id, sectionBody(draft, keys));
    setDetail(saved);
    setDraft((d) => (d ? { ...d, ...sectionBody(saved, keys) } : d));
  };

  const reloadFieldTranslations = async () => {
    const fresh = await host.unit(id);
    setDetail((d) => (d ? { ...d, fieldTranslations: fresh.fieldTranslations } : d));
  };

  const refresh = async () => {
    const [fresh, wizard] = await Promise.all([host.unit(id), host.wizard(id)]);
    setDetail(fresh);
    setStatus(wizard);
  };

  const live = detail.qrSlug !== null;
  const sections: PageSection[] = [
    { id: 'basics', label: 'Name and capacity', icon: Bed },
    {
      id: 'access',
      label: 'Wi-Fi, codes and arrival',
      icon: WifiHigh,
    },
    ...CORE_SECTIONS.map((section) => ({
      id: section.id,
      label: section.title,
      icon: CORE_SECTION_ICONS[section.id] ?? ClipboardText,
    })),
    { id: 'amenities', label: 'Amenities', icon: Couch },
    { id: UNIT_BLOCKS_ID, label: 'Guest guide', icon: BookOpenText },
    ...(live ? [{ id: 'calendars', label: 'Calendars', icon: CalendarDots }] : []),
  ];

  const renderSection = (sectionId: string) => {
    if (sectionId === 'basics') {
      return (
        <>
          <Section title="Unit name" onSave={saveFields(['name'])}>
            <TextField
              label="Name"
              hint="For example Apartment 1 or Studio Sea View."
              value={draft.name}
              maxLength={LIMITS.name}
              required
              onChange={(v) => set('name')(v ?? '')}
            />
          </Section>
          <Section
            title="Capacity"
            onSave={saveFields(['maxOccupancy', 'bedrooms', 'bathrooms', 'beds'])}
          >
            <div className="field-row">
              <NumberField
                label="Maximum guests"
                value={draft.maxOccupancy}
                min={1}
                max={50}
                onChange={set('maxOccupancy')}
              />
              <NumberField
                label="Bedrooms"
                value={draft.bedrooms}
                min={0}
                max={50}
                onChange={set('bedrooms')}
              />
              <NumberField
                label="Bathrooms"
                value={draft.bathrooms}
                min={0}
                max={50}
                onChange={set('bathrooms')}
              />
            </div>
            <BedsEditor beds={draft.beds} onChange={set('beds')} />
          </Section>
        </>
      );
    }
    if (sectionId === 'access') {
      return (
        <>
          <Section title="Wi-Fi" onSave={saveFields(['noWifi', 'wifiNetwork', 'wifiPassword'])}>
            <CheckboxField
              label="This unit has no Wi-Fi"
              checked={draft.noWifi}
              onChange={set('noWifi')}
            />
            {draft.noWifi ? null : (
              <div className="field-row">
                <TextField
                  label="Network name"
                  value={draft.wifiNetwork}
                  maxLength={LIMITS.shortText}
                  onChange={set('wifiNetwork')}
                />
                <TextField
                  label="Password"
                  value={draft.wifiPassword}
                  maxLength={LIMITS.wifiPassword}
                  onChange={set('wifiPassword')}
                />
              </div>
            )}
          </Section>
          <Section
            title="Door and lockbox codes"
            description="Guests see codes only from the arrival release."
            onSave={saveFields(['doorCode', 'lockboxCode'])}
          >
            <div className="field-row">
              <TextField
                label="Door code"
                value={draft.doorCode}
                maxLength={LIMITS.code}
                onChange={set('doorCode')}
              />
              <TextField
                label="Lockbox code"
                value={draft.lockboxCode}
                maxLength={LIMITS.code}
                onChange={set('lockboxCode')}
              />
            </div>
          </Section>
          <Section
            title="Arrival release"
            onSave={saveFields(['arrivalReleaseDaysBefore'])}
            description={`Door codes and arrival details appear at 00:00, ${releaseLabel(draft.arrivalReleaseDaysBefore).toLowerCase()}, ${detail.timezone} time.`}
          >
            <label className="field">
              <span className="field-label">Show arrival details</span>
              <select
                value={draft.arrivalReleaseDaysBefore}
                onChange={(e) => set('arrivalReleaseDaysBefore')(Number(e.target.value))}
              >
                {RELEASE_DAYS.map((d) => (
                  <option key={d} value={d}>
                    {releaseLabel(d)}
                  </option>
                ))}
              </select>
            </label>
          </Section>
        </>
      );
    }
    const core = CORE_SECTIONS.find((section) => section.id === sectionId);
    if (core) {
      return (
        <Section
          key={core.id}
          title={core.title}
          description="Values from the property apply here until you set one for this unit."
          onSave={saveFields(core.fields)}
        >
          {core.fields.map((field) => (
            <Fragment key={field}>
              <CoreField
                field={field}
                value={draft[field]}
                inherited={detail.propertyValues}
                onChange={(v) => setDraft((d) => (d ? { ...d, [field]: v } : d))}
              />
              <FieldTranslationStatus
                translation={detail.fieldTranslations.find((f) => f.field === field)}
                onChanged={reloadFieldTranslations}
              />
            </Fragment>
          ))}
        </Section>
      );
    }
    if (sectionId === 'amenities') {
      return (
        <AmenitiesEditor
          value={detail.amenities}
          inherited={detail.propertyAmenities}
          fieldTranslations={detail.fieldTranslations}
          onTranslationChanged={reloadFieldTranslations}
          onSave={async (list) => {
            const { amenities } = await host.setUnitAmenities(id, list);
            await reloadFieldTranslations();
            return amenities;
          }}
        />
      );
    }
    if (sectionId === 'calendars') {
      return <CalendarsPanel unitId={detail.id} />;
    }
    return (
      <Section
        title="Guest guide"
        description="The property's entries show on this unit unless you hide them or use a version for this unit."
      >
        <InheritedBlocks detail={detail} onChanged={refresh} />
        <h3>Only this unit</h3>
        <BlockList
          blocks={detail.blocks}
          create={(input) => host.createUnitBlock(id, input)}
          onChanged={refresh}
          emptyText="Nothing just for this unit yet."
        />
      </Section>
    );
  };

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to={`/properties/${detail.propertyId}`}>{detail.propertyName}</Link>
      </nav>
      <div className="page-head">
        <div className="page-title">
          <div className="title-line">
            <h1>{detail.name}</h1>
            {live ? (
              <span className="chip ok">Live</span>
            ) : (
              <span className="chip neutral">Setting up</span>
            )}
          </div>
          <p className="muted">{detail.propertyName}</p>
        </div>
        <div className="actions">
          {live ? (
            <Link className="button primary" to={`/stays/new?unit=${detail.id}`}>
              <Plus aria-hidden="true" weight="bold" />
              Register a Stay
            </Link>
          ) : null}
          <Menu
            label={`More actions for ${detail.name}`}
            trigger={<DotsThree aria-hidden="true" weight="bold" />}
            items={[
              ...(live
                ? [
                    {
                      label: 'Stays',
                      icon: <CalendarCheck aria-hidden="true" />,
                      onSelect: () => navigate(`/stays?unit=${detail.id}`),
                    },
                    {
                      label: 'Guest stats',
                      icon: <ChartBar aria-hidden="true" />,
                      onSelect: () => navigate(`/units/${detail.id}/stats`),
                    },
                  ]
                : []),
              {
                label: 'Delete unit',
                icon: <Trash aria-hidden="true" />,
                danger: true,
                onSelect: () => {
                  if (
                    !busy &&
                    window.confirm(`Delete ${detail.name}? Its QR code stops working.`)
                  ) {
                    void run(async () => {
                      await host.deleteUnit(id);
                      navigate(`/properties/${detail.propertyId}`, { replace: true });
                    });
                  }
                },
              },
            ]}
          />
        </div>
      </div>
      {error ? <p role="alert">{error}</p> : null}

      <div className="unit-overview">
        {status ? (
          <SetupPanels
            status={status}
            busy={busy}
            onGoLive={() =>
              void run(async () => {
                await host.goLive(id);
                await refresh();
              })
            }
            onRefresh={async () => setStatus(await host.wizard(id))}
          />
        ) : null}
        <QrPanel detail={detail} />
      </div>

      <SectionLayout sections={sections} label="Unit sections" render={renderSection} />
    </>
  );
}

/** Completeness and the go-live checklist, in the viewer's back-office language. */
function SetupPanels({
  status,
  busy,
  onGoLive,
  onRefresh,
}: {
  status: WizardStatus;
  busy: boolean;
  onGoLive: () => void;
  onRefresh: () => Promise<void>;
}) {
  const { ui } = useWizardCopy();
  const headingId = useId();
  const setup = (
    <section className="panel setup-panel" aria-labelledby={headingId}>
      <h2 id={headingId}>{ui.setup}</h2>
      <CompletenessBar {...status.progress} />
      <div className="actions">
        <Link
          className={status.live ? 'button' : 'button primary'}
          to={`/units/${status.unitId}/setup`}
        >
          {ui.openWizard}
          <CaretRight aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
  // Once live, the checklist has done its job: setup stays one click away.
  if (status.live) return setup;
  return (
    <>
      {setup}
      <GoLivePanel status={status} busy={busy} onGoLive={onGoLive} onRefresh={onRefresh} />
    </>
  );
}

function QrPanel({ detail }: { detail: UnitDetail }) {
  if (!detail.qrSlug || !detail.qrLink) {
    return (
      <section className="panel">
        <h2>QR code</h2>
        <p className="muted">Issued when the unit goes live.</p>
      </section>
    );
  }
  return (
    <section className="panel qr-panel">
      <img src={host.qrUrl(detail.id, 'svg')} alt={`QR code for ${detail.name}`} />
      <div>
        <h2>QR code</h2>
        <p className="muted">Guests scan it to open this unit. The link never changes.</p>
        <p className="mono-text">{detail.qrLink}</p>
        <div className="actions">
          <a className="button" href={host.qrUrl(detail.id, 'svg')} download>
            <DownloadSimple aria-hidden="true" />
            Download SVG
          </a>
          <a className="button" href={host.qrUrl(detail.id, 'png')} download>
            <DownloadSimple aria-hidden="true" />
            Download PNG
          </a>
        </div>
      </div>
    </section>
  );
}

function BedsEditor({
  beds,
  onChange,
}: {
  beds: Draft['beds'];
  onChange: (beds: Draft['beds']) => void;
}) {
  return (
    <fieldset className="beds">
      <legend>Beds</legend>
      {beds.map((bed, i) => (
        // Rows have no identity of their own; the index is the row.
        // biome-ignore lint/suspicious/noArrayIndexKey: see above
        <div className="field-row bed-row" key={i}>
          <SelectField
            label="Type"
            value={bed.type}
            options={BED_TYPES}
            labels={BED_LABELS}
            onChange={(type) =>
              type && onChange(beds.map((b, j) => (j === i ? { ...b, type } : b)))
            }
          />
          <NumberField
            label="Count"
            value={bed.count}
            min={1}
            max={20}
            onChange={(count) =>
              onChange(beds.map((b, j) => (j === i ? { ...b, count: count ?? 1 } : b)))
            }
          />
          <button
            type="button"
            className="icon-button"
            aria-label="Remove bed"
            onClick={() => onChange(beds.filter((_, j) => j !== i))}
          >
            <Trash aria-hidden="true" />
          </button>
        </div>
      ))}
      {beds.length < 10 ? (
        <button type="button" onClick={() => onChange([...beds, { type: 'double', count: 1 }])}>
          <Plus aria-hidden="true" weight="bold" />
          Add bed
        </button>
      ) : null}
    </fieldset>
  );
}

/** The property's blocks as this unit sees them: shown, hidden, or replaced by a unit block. */
function InheritedBlocks({
  detail,
  onChanged,
}: {
  detail: UnitDetail;
  onChanged: () => Promise<void>;
}) {
  const { busy, error, run } = useAction();
  const [replacing, setReplacing] = useState<Block | null>(null);
  const [warnings, setWarnings] = useState<SecretWarning[]>([]);
  const hidden = new Set(detail.hiddenBlockIds);
  const replacedBy = new Map(
    detail.blocks.filter((b) => b.replacesBlockId).map((b) => [b.replacesBlockId, b]),
  );

  const setHidden = (blockId: string, hide: boolean) =>
    void run(async () => {
      const next = hide
        ? [...detail.hiddenBlockIds, blockId]
        : detail.hiddenBlockIds.filter((x) => x !== blockId);
      await host.setHiddenBlocks(detail.id, next);
      await onChanged();
    });

  return (
    <div className="blocks">
      <h3>From the property</h3>
      {warnings.length > 0 ? <SecretWarnings warnings={warnings} /> : null}
      {error ? <p role="alert">{error}</p> : null}
      {detail.propertyBlocks.length === 0 ? (
        <p className="muted">The property has nothing in its guide yet.</p>
      ) : null}
      <ul className="rows">
        {detail.propertyBlocks.map((block) => {
          const replacement = replacedBy.get(block.id);
          const isHidden = hidden.has(block.id);
          if (replacing?.id === block.id) {
            return (
              <li key={block.id}>
                <BlockEditor
                  heading={`Your version of "${block.title}" for this unit`}
                  initial={{ ...block, category: block.category as HostBlockCategory }}
                  onSubmit={(input) =>
                    host.createUnitBlock(detail.id, { ...input, replacesBlockId: block.id })
                  }
                  onDone={(found) =>
                    void run(async () => {
                      await onChanged();
                      setReplacing(null);
                      setWarnings(found);
                    })
                  }
                  onCancel={() => setReplacing(null)}
                />
              </li>
            );
          }
          return (
            <li
              key={block.id}
              className={`block-row entry-row${isHidden || replacement ? ' faded' : ''}`}
            >
              <div className="block-text">
                <span className="block-title">
                  <strong>{block.title}</strong>
                  <TranslationChip status={block.translation.status} />
                </span>
                <span className="muted entry-preview">
                  {replacement
                    ? `This unit uses its own version: "${replacement.title}"`
                    : isHidden
                      ? 'Hidden on this unit'
                      : preview(block.body)}
                </span>
                <span className="entry-meta">{CATEGORY_LABELS[block.category]}</span>
              </div>
              <div className="entry-actions">
                {replacement ? null : isHidden ? (
                  <button type="button" disabled={busy} onClick={() => setHidden(block.id, false)}>
                    Show again
                  </button>
                ) : (
                  <Menu
                    label={`Change ${block.title} for this unit`}
                    trigger={<DotsThree aria-hidden="true" weight="bold" />}
                    items={[
                      {
                        label: 'Write a version for this unit',
                        icon: <PencilSimple aria-hidden="true" />,
                        onSelect: () => {
                          setWarnings([]);
                          setReplacing(block);
                        },
                      },
                      {
                        label: 'Hide on this unit',
                        icon: <EyeSlash aria-hidden="true" />,
                        onSelect: () => setHidden(block.id, true),
                      },
                    ]}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
