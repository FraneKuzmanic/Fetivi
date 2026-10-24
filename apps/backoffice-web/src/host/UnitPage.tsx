import { BED_TYPES, type HostBlockCategory, LIMITS } from '@fetivi/domain/vocabulary';
import { CaretRight, ChartBar, DownloadSimple, Plus, Trash } from '@phosphor-icons/react';
import { Fragment, useCallback, useEffect, useId, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
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
import { useAction } from '../useAction';
import { AmenitiesEditor } from './AmenitiesEditor';
import { BlockEditor, SecretWarnings } from './BlockEditor';
import { BlockList, preview } from './BlockList';
import { CORE_SECTIONS, CoreField } from './CoreFields';
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

  // A link with a section hash (the go-live checklist's translations item) scrolls to it on load.
  const { hash } = useLocation();
  const loaded = detail !== null;
  useEffect(() => {
    if (loaded && hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [loaded, hash]);

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

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/">Properties</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/properties/${detail.propertyId}`}>{detail.propertyName}</Link>
      </nav>
      <div className="page-head">
        <h1>{detail.name}</h1>
      </div>
      {error ? <p role="alert">{error}</p> : null}

      <div className="editor">
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
        <StaysPanel detail={detail} />
        {detail.qrSlug ? <CalendarsPanel unitId={detail.id} /> : null}

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

        <Section title="Wi-Fi" onSave={saveFields(['noWifi', 'wifiNetwork', 'wifiPassword'])}>
          <CheckboxField
            label="This unit has no Wi-Fi"
            checked={draft.noWifi}
            onChange={set('noWifi')}
          />
          {draft.noWifi ? null : (
            <>
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
            </>
          )}
        </Section>

        <Section
          title="Door and lockbox codes"
          description="Guests see codes only from the arrival release."
          onSave={saveFields(['doorCode', 'lockboxCode'])}
        >
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
        </Section>

        <Section
          title="Arrival release"
          onSave={saveFields(['arrivalReleaseDaysBefore'])}
          description={`Arrival details appear at 00:00, ${releaseLabel(draft.arrivalReleaseDaysBefore).toLowerCase()}, ${detail.timezone} time.`}
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

        {CORE_SECTIONS.map((section) => (
          <Section
            key={section.title}
            title={section.title}
            description="Empty fields use the property's value."
            onSave={saveFields(section.fields)}
          >
            {section.fields.map((field) => (
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
        ))}

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

        <Section
          id={UNIT_BLOCKS_ID}
          title="Guest information"
          description="Property blocks show on this unit unless you hide or replace them here."
        >
          <InheritedBlocks detail={detail} onChanged={refresh} />
          <h3>Only this unit</h3>
          <BlockList
            blocks={detail.blocks}
            create={(input) => host.createUnitBlock(id, input)}
            onChanged={refresh}
            emptyText="No blocks of its own yet."
          />
        </Section>

        <section className="panel danger-zone">
          <h2>Delete unit</h2>
          <p className="muted">Its QR code stops working. This cannot be undone.</p>
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Delete ${detail.name}? Its QR code stops working.`)) {
                void run(async () => {
                  await host.deleteUnit(id);
                  navigate(`/properties/${detail.propertyId}`, { replace: true });
                });
              }
            }}
          >
            Delete unit
          </button>
        </section>
      </div>
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
  return (
    <>
      <section className="panel" aria-labelledby={headingId}>
        <h2 id={headingId}>{ui.setup}</h2>
        <CompletenessBar {...status.progress} />
        <div className="actions">
          <Link className="button primary" to={`/units/${status.unitId}/setup`}>
            {ui.openWizard}
            <CaretRight aria-hidden="true" />
          </Link>
        </div>
      </section>
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

function StaysPanel({ detail }: { detail: UnitDetail }) {
  const headingId = useId();
  return (
    <section className="panel" aria-labelledby={headingId}>
      <h2 id={headingId}>Stays</h2>
      {detail.qrSlug ? (
        <>
          <p className="muted">Register each guest party to get a PIN for them.</p>
          <div className="actions">
            <Link className="button primary" to={`/stays/new?unit=${detail.id}`}>
              <Plus aria-hidden="true" weight="bold" />
              Register a Stay
            </Link>
            <Link className="button" to={`/stays?unit=${detail.id}`}>
              See Stays
            </Link>
            <Link className="button" to={`/units/${detail.id}/stats`}>
              <ChartBar aria-hidden="true" />
              See guest stats
            </Link>
          </div>
        </>
      ) : (
        <p className="muted">Stays can be registered once the unit is live.</p>
      )}
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
        <p className="muted">The property has no blocks yet.</p>
      ) : null}
      <ul className="rows">
        {detail.propertyBlocks.map((block) => {
          const replacement = replacedBy.get(block.id);
          const isHidden = hidden.has(block.id);
          if (replacing?.id === block.id) {
            return (
              <li key={block.id}>
                <BlockEditor
                  heading={`Replace "${block.title}" for this unit`}
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
            <li key={block.id} className={`block-row${isHidden || replacement ? ' faded' : ''}`}>
              <div className="block-text">
                <span className="eyebrow">{CATEGORY_LABELS[block.category]}</span>
                <span className="block-title">
                  <strong>{block.title}</strong>
                  <TranslationChip status={block.translation.status} />
                </span>
                <span className="muted">
                  {replacement
                    ? `Replaced here by "${replacement.title}"`
                    : isHidden
                      ? 'Hidden on this unit'
                      : preview(block.body)}
                </span>
              </div>
              <div className="actions">
                {replacement ? null : isHidden ? (
                  <button type="button" disabled={busy} onClick={() => setHidden(block.id, false)}>
                    Show again
                  </button>
                ) : (
                  <>
                    <button type="button" disabled={busy} onClick={() => setHidden(block.id, true)}>
                      Hide for this unit
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setWarnings([]);
                        setReplacing(block);
                      }}
                    >
                      Replace for this unit
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
