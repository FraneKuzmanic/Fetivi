import { LIMITS, PROPERTY_TYPES } from '@fetivi/domain/vocabulary';
import {
  BookOpenText,
  CaretRight,
  ClipboardText,
  Couch,
  DoorOpen,
  DotsThree,
  MapPin,
  Plus,
  Star,
  Trash,
} from '@phosphor-icons/react';
import { type FormEvent, Fragment, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { host, type PropertyDetail, type PropertyPatch } from '../api';
import { Section, SelectField, TextField } from '../forms/fields';
import { PROPERTY_TYPE_LABELS } from '../forms/labels';
import { sectionBody } from '../forms/patch';
import { Menu } from '../shell/Menu';
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

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/properties">Properties</Link>
      </nav>
      <div className="page-head">
        <h1>Add property</h1>
      </div>
      <section className="panel narrow">
        <form onSubmit={submit}>
          <div className="fields">
            <TextField
              label="Property name"
              hint="Guests see this name, for example Villa Mare."
              value={name}
              maxLength={LIMITS.name}
              required
              onChange={setName}
            />
            <TextField label="City" value={city} maxLength={LIMITS.shortText} onChange={setCity} />
          </div>
          {error ? <p role="alert">{error}</p> : null}
          <div className="actions">
            <button type="submit" className="primary" disabled={busy}>
              Create property
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
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { busy, error, run } = useAction();
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

  if (!detail || !draft) {
    return error ? <p role="alert">{error}</p> : <p className="muted">Loading…</p>;
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
    { id: 'basics', label: 'Basics and location', icon: MapPin },
    ...CORE_SECTIONS.map((section) => ({
      id: section.id,
      label: section.title,
      icon: CORE_SECTION_ICONS[section.id] ?? ClipboardText,
    })),
    { id: 'amenities', label: 'Amenities', icon: Couch },
    {
      id: 'guide',
      label: 'Guest guide',
      icon: BookOpenText,
      note: detail.blocks.length === 0 ? 'Empty' : undefined,
    },
    { id: 'picks', label: 'Host picks and tips', icon: Star, to: `/properties/${id}/picks` },
  ];

  const renderSection = (sectionId: string) => {
    if (sectionId === 'basics') {
      return (
        <Section title="Basics and location" onSave={saveBasics}>
          <TextField
            label="Property name"
            hint="Guests see this name, for example Villa Mare."
            value={draft.name}
            maxLength={LIMITS.name}
            required
            onChange={(v) => set('name')(v ?? '')}
          />
          <SelectField
            label="Property type"
            hint="Decides which questions the setup wizard asks."
            value={draft.propertyType}
            options={PROPERTY_TYPES}
            labels={PROPERTY_TYPE_LABELS}
            emptyLabel="Not set"
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
            <span className="field-label">Time zone</span>
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
              label="Building door code"
              hint="Shared by every unit. Shown to guests only from the arrival release."
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
      <Section
        title="Guest guide"
        description="What every unit of this property shows in the guest's Guide. A unit can hide an entry or use its own version."
      >
        <BlockList
          blocks={detail.blocks}
          create={(input) => host.createPropertyBlock(id, input)}
          onChanged={reloadBlocks}
          emptyText="Nothing in the guide yet. Start with how guests get in."
        />
      </Section>
    );
  };

  const meta = [
    detail.city,
    detail.propertyType ? PROPERTY_TYPE_LABELS[detail.propertyType] : null,
  ].filter(Boolean);

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/properties">Properties</Link>
      </nav>
      <div className="page-head">
        <div className="page-title">
          <div className="title-line">
            <h1>{detail.name}</h1>
            <StatusChip approved={detail.approved} />
          </div>
          {meta.length > 0 ? <p className="muted">{meta.join(' · ')}</p> : null}
        </div>
        <Menu
          label={`More actions for ${detail.name}`}
          trigger={<DotsThree aria-hidden="true" weight="bold" />}
          items={[
            {
              label: 'Delete property',
              icon: <Trash aria-hidden="true" />,
              danger: true,
              onSelect: () => {
                if (
                  !busy &&
                  window.confirm(`Delete ${detail.name} and all its units? This cannot be undone.`)
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

      <SectionLayout sections={sections} label="Property sections" render={renderSection} />
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
        <h2 id="units-heading">Units</h2>
        <p className="muted">
          {detail.approved
            ? 'Each unit has its own QR code for guests.'
            : 'Each unit gets its QR code once Fetivi approves the property.'}
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
                <span className="chip ok">Live</span>
              ) : (
                <span className="chip neutral">Setting up</span>
              )}
              <CaretRight className="row-caret" aria-hidden="true" />
            </Link>
          </li>
        ))}
        <li>
          <form className="add-row" onSubmit={submit}>
            <TextField
              label="New unit name"
              hideLabel
              placeholder="New unit, for example Apartment 2"
              value={name}
              maxLength={LIMITS.name}
              required
              onChange={setName}
            />
            <button type="submit" disabled={busy}>
              <Plus aria-hidden="true" weight="bold" />
              Add unit
            </button>
          </form>
        </li>
      </ul>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
