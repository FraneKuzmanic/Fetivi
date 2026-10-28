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
import { useTranslation } from 'react-i18next';
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
import { sectionBody } from '../forms/patch';
import { i18next } from '../i18n';
import { useLabels } from '../i18n/useLabels';
import { useConfirm } from '../shell/ConfirmDialog';
import { Menu } from '../shell/Menu';
import { MoreActions } from '../shell/MoreActions';
import { usePageTitle } from '../shell/PageTitle';
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
  if (days === 0) return i18next.t('host:unit.releaseSameDay');
  return i18next.t('host:unit.releaseDays', { count: days });
}

export function UnitPage() {
  const { t } = useTranslation(['host', 'common']);
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { busy, error, run } = useAction();
  const confirm = useConfirm();
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

  usePageTitle(detail?.name);

  if (!detail || !draft) {
    return error ? <p role="alert">{error}</p> : <p className="muted">{t('common:loading')}</p>;
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
    { id: 'basics', label: t('unit.basics'), icon: Bed },
    {
      id: 'access',
      label: t('unit.access'),
      icon: WifiHigh,
    },
    ...CORE_SECTIONS.map((section) => ({
      id: section.id,
      label: section.title,
      icon: CORE_SECTION_ICONS[section.id] ?? ClipboardText,
    })),
    { id: 'amenities', label: t('core.amenities'), icon: Couch },
    { id: UNIT_BLOCKS_ID, label: t('property.guide'), icon: BookOpenText },
    ...(live ? [{ id: 'calendars', label: t('unit.calendars'), icon: CalendarDots }] : []),
  ];

  const renderSection = (sectionId: string) => {
    if (sectionId === 'basics') {
      return (
        <>
          <Section title={t('unit.unitName')} onSave={saveFields(['name'])}>
            <TextField
              label={t('unit.name')}
              hint={t('unit.nameHint')}
              value={draft.name}
              maxLength={LIMITS.name}
              required
              onChange={(v) => set('name')(v ?? '')}
            />
          </Section>
          <Section
            title={t('unit.capacity')}
            onSave={saveFields(['maxOccupancy', 'bedrooms', 'bathrooms', 'beds'])}
          >
            <div className="field-row">
              <NumberField
                label={t('unit.maxGuests')}
                value={draft.maxOccupancy}
                min={1}
                max={50}
                onChange={set('maxOccupancy')}
              />
              <NumberField
                label={t('unit.bedrooms')}
                value={draft.bedrooms}
                min={0}
                max={50}
                onChange={set('bedrooms')}
              />
              <NumberField
                label={t('unit.bathrooms')}
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
          <Section
            title={t('unit.wifi')}
            onSave={saveFields(['noWifi', 'wifiNetwork', 'wifiPassword'])}
          >
            <CheckboxField
              label={t('unit.noWifi')}
              checked={draft.noWifi}
              onChange={set('noWifi')}
            />
            {draft.noWifi ? null : (
              <div className="field-row">
                <TextField
                  label={t('unit.network')}
                  value={draft.wifiNetwork}
                  maxLength={LIMITS.shortText}
                  onChange={set('wifiNetwork')}
                />
                <TextField
                  label={t('unit.password')}
                  value={draft.wifiPassword}
                  maxLength={LIMITS.wifiPassword}
                  onChange={set('wifiPassword')}
                />
              </div>
            )}
          </Section>
          <Section
            title={t('unit.codes')}
            description={t('unit.codesHint')}
            onSave={saveFields(['doorCode', 'lockboxCode'])}
          >
            <div className="field-row">
              <TextField
                label={t('unit.doorCode')}
                value={draft.doorCode}
                maxLength={LIMITS.code}
                onChange={set('doorCode')}
              />
              <TextField
                label={t('unit.lockboxCode')}
                value={draft.lockboxCode}
                maxLength={LIMITS.code}
                onChange={set('lockboxCode')}
              />
            </div>
          </Section>
          <Section
            title={t('unit.release')}
            onSave={saveFields(['arrivalReleaseDaysBefore'])}
            description={
              draft.arrivalReleaseDaysBefore === 0
                ? t('unit.releaseHintSameDay', { zone: detail.timezone })
                : t('unit.releaseHint', {
                    count: draft.arrivalReleaseDaysBefore,
                    zone: detail.timezone,
                  })
            }
          >
            <label className="field">
              <span className="field-label">{t('unit.showArrival')}</span>
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
          description={t('unit.coreHint')}
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
      <Section title={t('property.guide')} description={t('unit.guideHint')}>
        <InheritedBlocks detail={detail} onChanged={refresh} />
        <h3>{t('unit.onlyThisUnit')}</h3>
        <BlockList
          blocks={detail.blocks}
          create={(input) => host.createUnitBlock(id, input)}
          onChanged={refresh}
          emptyText={t('unit.onlyEmpty')}
        />
      </Section>
    );
  };

  return (
    <>
      <nav className="crumbs" aria-label={t('common:page.breadcrumb')}>
        <Link to={`/properties/${detail.propertyId}`}>{detail.propertyName}</Link>
      </nav>
      <div className="page-head">
        <div className="page-title">
          <div className="title-line">
            {live ? (
              <span className="chip ok">{t('today.live')}</span>
            ) : (
              <span className="chip neutral">{t('today.settingUp')}</span>
            )}
          </div>
        </div>
        <div className="actions">
          {live ? (
            <Link className="button primary" to={`/stays/new?unit=${detail.id}`}>
              <Plus aria-hidden="true" weight="bold" />
              {t('stays.registerStay')}
            </Link>
          ) : null}
          <MoreActions
            label={t('property.moreActions', { name: detail.name })}
            items={[
              ...(live
                ? [
                    {
                      label: t('unit.stays'),
                      icon: <CalendarCheck aria-hidden="true" />,
                      onSelect: () => navigate(`/stays?unit=${detail.id}`),
                    },
                    {
                      label: t('unit.stats'),
                      icon: <ChartBar aria-hidden="true" />,
                      onSelect: () => navigate(`/units/${detail.id}/stats`),
                    },
                  ]
                : []),
              {
                label: t('unit.delete'),
                icon: <Trash aria-hidden="true" />,
                danger: true,
                onSelect: async () => {
                  if (
                    !busy &&
                    (await confirm({
                      title: t('property.deleteTitle', { name: detail.name }),
                      body: t('unit.deleteBody'),
                      action: t('unit.delete'),
                      danger: true,
                    }))
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

      <SectionLayout sections={sections} label={t('unit.sections')} render={renderSection} />
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
  const { t } = useTranslation(['host', 'common']);
  if (!detail.qrSlug || !detail.qrLink) {
    return (
      <section className="panel">
        <h2>{t('unit.qr')}</h2>
        <p className="muted">{t('unit.qrPending')}</p>
      </section>
    );
  }
  return (
    <section className="panel qr-panel">
      <img src={host.qrUrl(detail.id, 'svg')} alt={t('unit.qrAlt', { name: detail.name })} />
      <div>
        <h2>{t('unit.qr')}</h2>
        <p className="muted">{t('unit.qrHint')}</p>
        <p className="mono-text">{detail.qrLink}</p>
        <div className="actions">
          <a className="button" href={host.qrUrl(detail.id, 'svg')} download>
            <DownloadSimple aria-hidden="true" />
            {t('unit.downloadSvg')}
          </a>
          <a className="button" href={host.qrUrl(detail.id, 'png')} download>
            <DownloadSimple aria-hidden="true" />
            {t('unit.downloadPng')}
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
  const { t } = useTranslation(['host', 'common']);
  const labels = useLabels();
  return (
    <fieldset className="beds">
      <legend>{t('unit.beds')}</legend>
      {beds.map((bed, i) => (
        // Rows have no identity of their own; the index is the row.
        // biome-ignore lint/suspicious/noArrayIndexKey: see above
        <div className="field-row bed-row" key={i}>
          <SelectField
            label={t('unit.bedType')}
            value={bed.type}
            options={BED_TYPES}
            labels={labels.bed}
            onChange={(type) =>
              type && onChange(beds.map((b, j) => (j === i ? { ...b, type } : b)))
            }
          />
          <NumberField
            label={t('unit.bedCount')}
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
            aria-label={t('unit.removeBed')}
            onClick={() => onChange(beds.filter((_, j) => j !== i))}
          >
            <Trash aria-hidden="true" />
          </button>
        </div>
      ))}
      {beds.length < 10 ? (
        <button type="button" onClick={() => onChange([...beds, { type: 'double', count: 1 }])}>
          <Plus aria-hidden="true" weight="bold" />
          {t('unit.addBed')}
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
  const { t } = useTranslation(['host', 'common']);
  const labels = useLabels();
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
      <h3>{t('unit.fromProperty')}</h3>
      {warnings.length > 0 ? <SecretWarnings warnings={warnings} /> : null}
      {error ? <p role="alert">{error}</p> : null}
      {detail.propertyBlocks.length === 0 ? (
        <p className="muted">{t('unit.propertyEmpty')}</p>
      ) : null}
      <ul className="rows">
        {detail.propertyBlocks.map((block) => {
          const replacement = replacedBy.get(block.id);
          const isHidden = hidden.has(block.id);
          if (replacing?.id === block.id) {
            return (
              <li key={block.id}>
                <BlockEditor
                  heading={t('unit.yourVersion', { title: block.title })}
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
                    ? t('unit.ownVersion', { title: replacement.title })
                    : isHidden
                      ? t('unit.hidden')
                      : preview(block.body)}
                </span>
                <span className="entry-meta">{labels.category[block.category]}</span>
              </div>
              <div className="entry-actions">
                {replacement ? null : isHidden ? (
                  <button type="button" disabled={busy} onClick={() => setHidden(block.id, false)}>
                    {t('unit.showAgain')}
                  </button>
                ) : (
                  <Menu
                    label={t('unit.change', { title: block.title })}
                    trigger={<DotsThree aria-hidden="true" weight="bold" />}
                    items={[
                      {
                        label: t('unit.writeVersion'),
                        icon: <PencilSimple aria-hidden="true" />,
                        onSelect: () => {
                          setWarnings([]);
                          setReplacing(block);
                        },
                      },
                      {
                        label: t('unit.hide'),
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
