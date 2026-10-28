import { LIMITS, PROPERTY_TYPES } from '@fetivi/domain/vocabulary';
import {
  BookOpenText,
  CaretRight,
  ClipboardText,
  Couch,
  DoorOpen,
  MapPin,
  Plus,
  Star,
  Trash,
} from '@phosphor-icons/react';
import { type FormEvent, Fragment, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { host, type PropertyDetail, type PropertyPatch } from '../api';
import { Section, SelectField, TextField } from '../forms/fields';
import { sectionBody } from '../forms/patch';
import { useLabels } from '../i18n/useLabels';
import { useConfirm } from '../shell/ConfirmDialog';
import { MoreActions } from '../shell/MoreActions';
import { usePageTitle } from '../shell/PageTitle';
import { useAction } from '../useAction';
import { AmenitiesEditor } from './AmenitiesEditor';
import { AddressFields } from './address/AddressFields';
import { BlockList } from './BlockList';
import { CORE_SECTION_ICONS, CORE_SECTIONS, CoreField } from './CoreFields';
import { StatusChip } from './PropertiesPage';
import { type PageSection, SectionLayout } from './SectionLayout';
import { FieldTranslationStatus } from './translations/FieldTranslationStatus';
import { usePendingRefresh } from './translations/usePendingRefresh';

const ZONES = Intl.supportedValuesOf('timeZone');

/** /properties/new: just a name, then the full editor. */
export function NewPropertyPage() {
  const { t } = useTranslation(['host', 'common']);
  const navigate = useNavigate();
  const { busy, error, run } = useAction();
  const [name, setName] = useState<string | null>(null);
  const [city, setCity] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const created = await host.createProperty({ name: name ?? '', city });
      navigate(`/properties/${created.id}`, { replace: true });
    });
  }

  usePageTitle(t('property.addTitle'));

  return (
    <>
      <nav className="crumbs" aria-label={t('common:page.breadcrumb')}>
        <Link to="/properties">{t('properties.title')}</Link>
      </nav>
      <section className="panel narrow">
        <form onSubmit={submit}>
          <div className="fields">
            <TextField
              label={t('property.name')}
              hint={t('property.nameHint')}
              value={name}
              maxLength={LIMITS.name}
              required
              onChange={setName}
            />
            <TextField
              label={t('core.city')}
              value={city}
              maxLength={LIMITS.shortText}
              onChange={setCity}
            />
          </div>
          {error ? <p role="alert">{error}</p> : null}
          <div className="actions">
            <button type="submit" className="primary" disabled={busy}>
              {t('property.create')}
            </button>
          </div>
        </form>
      </section>
    </>
  );
}

type Draft = Omit<
  PropertyDetail,
  'id' | 'approved' | 'amenities' | 'blocks' | 'units' | 'fieldTranslations'
>;

export function PropertyPage() {
  const { t } = useTranslation(['host', 'common']);
  const labels = useLabels();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { busy, error, run } = useAction();
  const confirm = useConfirm();
  const [detail, setDetail] = useState<PropertyDetail | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [coords, setCoords] = useState<{ lat: number | null; lng: number | null }>({
    lat: null,
    lng: null,
  });

  const load = useCallback(
    () =>
      run(async () => {
        const fresh = await host.property(id);
        setDetail(fresh);
        setDraft(fresh);
        setCoords({ lat: fresh.location?.lat ?? null, lng: fresh.location?.lng ?? null });
      }),
    [id, run],
  );

  useEffect(() => {
    void load();
  }, [load]);

  usePendingRefresh(
    [
      ...(detail?.blocks ?? []),
      ...(detail?.fieldTranslations ?? []).map((f) => ({ translation: { status: f.status } })),
    ],
    async () => {
      const fresh = await host.property(id);
      setDetail((d) =>
        d ? { ...d, blocks: fresh.blocks, fieldTranslations: fresh.fieldTranslations } : d,
      );
    },
  );

  usePageTitle(detail?.name);

  if (!detail || !draft) {
    return error ? <p role="alert">{error}</p> : <p className="muted">{t('common:loading')}</p>;
  }

  const set =
    <K extends keyof Draft>(key: K) =>
    (value: Draft[K]) =>
      setDraft((d) => (d ? { ...d, [key]: value } : d));

  /** Saves one section and takes the saved values back, leaving other sections' edits alone. */
  const saveFields = (keys: readonly (keyof Draft)[]) => async () => {
    const saved = await host.updateProperty(id, sectionBody(draft, keys) as PropertyPatch);
    setDetail(saved);
    setDraft((d) => (d ? { ...d, ...sectionBody(saved, keys) } : d));
  };

  const saveBasics = async () => {
    // Both or neither; one alone is sent as is and the API refuses it.
    const location =
      coords.lat === null && coords.lng === null
        ? null
        : ({ lat: coords.lat, lng: coords.lng } as { lat: number; lng: number });
    setDraft((d) => (d ? { ...d, location } : d));
    const keys = [
      'name',
      'propertyType',
      'addressLine',
      'city',
      'postalCode',
      'country',
      'timezone',
    ] as const;
    const saved = await host.updateProperty(id, { ...sectionBody(draft, keys), location });
    setDetail(saved);
    setDraft((d) => (d ? { ...d, ...sectionBody(saved, [...keys, 'location']) } : d));
  };

  const zones = ZONES.includes(draft.timezone) ? ZONES : [draft.timezone, ...ZONES];

  const reloadBlocks = async () => {
    const fresh = await host.property(id);
    setDetail((d) => (d ? { ...d, blocks: fresh.blocks } : d));
  };

  const reloadFieldTranslations = async () => {
    const fresh = await host.property(id);
    setDetail((d) => (d ? { ...d, fieldTranslations: fresh.fieldTranslations } : d));
  };

  const sections: PageSection[] = [
    { id: 'basics', label: t('property.basics'), icon: MapPin },
    ...CORE_SECTIONS.map((section) => ({
      id: section.id,
      label: section.title,
      icon: CORE_SECTION_ICONS[section.id] ?? ClipboardText,
    })),
    { id: 'amenities', label: t('core.amenities'), icon: Couch },
    {
      id: 'guide',
      label: t('property.guide'),
      icon: BookOpenText,
      note: detail.blocks.length === 0 ? t('property.empty') : undefined,
    },
    {
      id: 'picks',
      label: t('property.picks'),
      icon: Star,
      to: `/properties/${id}/picks`,
    },
  ];

  const renderSection = (sectionId: string) => {
    if (sectionId === 'basics') {
      return (
        <Section title={t('property.basics')} onSave={saveBasics}>
          <TextField
            label={t('property.name')}
            hint={t('property.nameHint')}
            value={draft.name}
            maxLength={LIMITS.name}
            required
            onChange={(v) => set('name')(v ?? '')}
          />
          <SelectField
            label={t('property.type')}
            hint={t('property.typeHint')}
            value={draft.propertyType}
            options={PROPERTY_TYPES}
            labels={labels.propertyType}
            emptyLabel={t('common:field.notSet')}
            onChange={set('propertyType')}
          />
          <AddressFields
            value={{
              addressLine: draft.addressLine,
              postalCode: draft.postalCode,
              city: draft.city,
              country: draft.country,
              lat: coords.lat,
              lng: coords.lng,
            }}
            onChange={(next) => {
              setDraft((d) =>
                d
                  ? {
                      ...d,
                      addressLine: next.addressLine,
                      postalCode: next.postalCode,
                      city: next.city,
                      country: next.country ?? d.country,
                    }
                  : d,
              );
              setCoords({ lat: next.lat, lng: next.lng });
            }}
          />
          <label className="field">
            <span className="field-label">{t('property.timeZone')}</span>
            <select value={draft.timezone} onChange={(e) => set('timezone')(e.target.value)}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </label>
        </Section>
      );
    }
    const core = CORE_SECTIONS.find((section) => section.id === sectionId);
    if (core) {
      const isArrival = core.id === 'arrival';
      const keys: (keyof Draft)[] = isArrival
        ? [...core.fields, 'buildingDoorCode']
        : [...core.fields];
      return (
        <Section key={core.id} title={core.title} onSave={saveFields(keys)}>
          {core.fields.map((field) => (
            <Fragment key={field}>
              <CoreField
                field={field}
                value={draft[field]}
                onChange={(v) => setDraft((d) => (d ? { ...d, [field]: v } : d))}
              />
              <FieldTranslationStatus
                translation={detail.fieldTranslations.find((f) => f.field === field)}
                onChanged={reloadFieldTranslations}
              />
            </Fragment>
          ))}
          {isArrival ? (
            <TextField
              label={t('property.doorCode')}
              hint={t('property.doorCodeHint')}
              value={draft.buildingDoorCode}
              maxLength={LIMITS.code}
              onChange={set('buildingDoorCode')}
            />
          ) : null}
        </Section>
      );
    }
    if (sectionId === 'amenities') {
      return (
        <AmenitiesEditor
          value={detail.amenities}
          fieldTranslations={detail.fieldTranslations}
          onTranslationChanged={reloadFieldTranslations}
          onSave={async (list) => {
            const { amenities } = await host.setPropertyAmenities(id, list);
            await reloadFieldTranslations();
            return amenities;
          }}
        />
      );
    }
    return (
      <Section title={t('property.guide')} description={t('property.guideHint')}>
        <BlockList
          blocks={detail.blocks}
          create={(input) => host.createPropertyBlock(id, input)}
          onChanged={reloadBlocks}
          emptyText={t('property.guideEmpty')}
        />
      </Section>
    );
  };

  const meta = [
    detail.city,
    detail.propertyType ? labels.propertyType[detail.propertyType] : null,
  ].filter(Boolean);

  return (
    <>
      <nav className="crumbs" aria-label={t('common:page.breadcrumb')}>
        <Link to="/properties">{t('properties.title')}</Link>
      </nav>
      <div className="page-head">
        <div className="page-title">
          <div className="title-line">
            <StatusChip approved={detail.approved} />
          </div>
          {meta.length > 0 ? <p className="muted">{meta.join(' · ')}</p> : null}
        </div>
        <MoreActions
          label={t('property.moreActions', { name: detail.name })}
          items={[
            {
              label: t('property.delete'),
              icon: <Trash aria-hidden="true" />,
              danger: true,
              onSelect: async () => {
                if (
                  !busy &&
                  (await confirm({
                    title: t('property.deleteTitle', { name: detail.name }),
                    body: t('property.deleteBody'),
                    action: t('property.delete'),
                    danger: true,
                  }))
                ) {
                  void run(async () => {
                    await host.deleteProperty(id);
                    navigate('/properties', { replace: true });
                  });
                }
              },
            },
          ]}
        />
      </div>
      {error ? <p role="alert">{error}</p> : null}

      <UnitsPanel detail={detail} onCreated={(unitId) => navigate(`/units/${unitId}`)} />

      <SectionLayout sections={sections} label={t('property.sections')} render={renderSection} />
    </>
  );
}

function UnitsPanel({
  detail,
  onCreated,
}: {
  detail: PropertyDetail;
  onCreated: (unitId: string) => void;
}) {
  const { t } = useTranslation(['host', 'common']);
  const { busy, error, run } = useAction();
  const [name, setName] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const unit = await host.createUnit(detail.id, name ?? '');
      onCreated(unit.id);
    });
  }

  return (
    <section className="units-section" aria-labelledby="units-heading">
      <div className="section-head">
        <h2 id="units-heading">{t('property.units')}</h2>
        <p className="muted">
          {detail.approved ? t('property.unitsLive') : t('property.unitsWaiting')}
        </p>
      </div>
      <ul className="rows">
        {detail.units.map((u) => (
          <li key={u.id}>
            <Link to={`/units/${u.id}`} className="row-link unit-link">
              <span className="unit-link-icon" aria-hidden="true">
                <DoorOpen />
              </span>
              <strong>{u.name}</strong>
              {u.qrSlug ? (
                <span className="chip ok">{t('today.live')}</span>
              ) : (
                <span className="chip neutral">{t('today.settingUp')}</span>
              )}
              <CaretRight className="row-caret" aria-hidden="true" />
            </Link>
          </li>
        ))}
        <li>
          <form className="add-row" onSubmit={submit}>
            <TextField
              label={t('property.newUnit')}
              hideLabel
              placeholder={t('property.newUnitPlaceholder')}
              value={name}
              maxLength={LIMITS.name}
              required
              onChange={setName}
            />
            <button type="submit" disabled={busy}>
              <Plus aria-hidden="true" weight="bold" />
              {t('property.addUnit')}
            </button>
          </form>
        </li>
      </ul>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
