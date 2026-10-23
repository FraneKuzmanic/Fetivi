import { LIMITS, PROPERTY_TYPES } from '@fetivi/domain/vocabulary';
import { CaretRight, Plus, QrCode, Star } from '@phosphor-icons/react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { host, type PropertyDetail, type PropertyPatch } from '../api';
import { NumberField, Section, SelectField, TextField } from '../forms/fields';
import { PROPERTY_TYPE_LABELS } from '../forms/labels';
import { sectionBody } from '../forms/patch';
import { useAction } from '../useAction';
import { AmenitiesEditor } from './AmenitiesEditor';
import { BlockList } from './BlockList';
import { CORE_SECTIONS, CoreField } from './CoreFields';
import { StatusChip } from './PropertiesPage';
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
        <Link to="/">Properties</Link>
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

type Draft = Omit<PropertyDetail, 'id' | 'approved' | 'amenities' | 'blocks' | 'units'>;

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

  usePendingRefresh(detail?.blocks ?? [], async () => {
    const fresh = await host.property(id);
    setDetail((d) => (d ? { ...d, blocks: fresh.blocks } : d));
  });

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

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/">Properties</Link>
      </nav>
      <div className="page-head">
        <h1>{detail.name}</h1>
        <StatusChip approved={detail.approved} />
      </div>
      {error ? <p role="alert">{error}</p> : null}

      <div className="editor">
        <Section title="Basics and location" onSave={saveBasics}>
          <TextField
            label="Property name"
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
          <TextField
            label="Street address"
            value={draft.addressLine}
            maxLength={LIMITS.shortText}
            onChange={set('addressLine')}
          />
          <div className="field-row">
            <TextField
              label="Postal code"
              value={draft.postalCode}
              maxLength={LIMITS.shortText}
              onChange={set('postalCode')}
            />
            <TextField
              label="City"
              value={draft.city}
              maxLength={LIMITS.shortText}
              onChange={set('city')}
            />
          </div>
          <div className="field-row">
            <TextField
              label="Country code"
              hint="Two letters, for example HR."
              value={draft.country}
              maxLength={2}
              onChange={(v) => set('country')(v ?? '')}
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
          </div>
          <div className="field-row">
            <NumberField
              label="Latitude"
              value={coords.lat}
              min={-90}
              max={90}
              step="any"
              placeholder="43.5170"
              onChange={(lat) => setCoords((c) => ({ ...c, lat }))}
            />
            <NumberField
              label="Longitude"
              value={coords.lng}
              min={-180}
              max={180}
              step="any"
              placeholder="16.2514"
              onChange={(lng) => setCoords((c) => ({ ...c, lng }))}
            />
          </div>
        </Section>

        {CORE_SECTIONS.map((section) => {
          const isArrival = section.id === 'arrival';
          const keys: (keyof Draft)[] = isArrival
            ? [...section.fields, 'buildingDoorCode']
            : [...section.fields];
          return (
            <Section key={section.title} title={section.title} onSave={saveFields(keys)}>
              {section.fields.map((field) => (
                <CoreField
                  key={field}
                  field={field}
                  value={draft[field]}
                  onChange={(v) => setDraft((d) => (d ? { ...d, [field]: v } : d))}
                />
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
        })}

        <AmenitiesEditor
          value={detail.amenities}
          onSave={async (list) => (await host.setPropertyAmenities(id, list)).amenities}
        />

        <Section
          title="Guest information"
          description="Blocks every unit shows in the guest Guide. A unit can hide or replace one."
        >
          <BlockList
            blocks={detail.blocks}
            create={(input) => host.createPropertyBlock(id, input)}
            onChanged={reloadBlocks}
            emptyText="No blocks yet. Start with how guests get in."
          />
        </Section>

        <section className="panel">
          <h2>Host picks and tips</h2>
          <p className="muted">
            Recommend places from Fetivi's catalog, add your own, and write Neighbourhood tips.
          </p>
          <div>
            <Link className="button" to={`/properties/${id}/picks`}>
              <Star aria-hidden="true" />
              Open host picks
            </Link>
          </div>
        </section>

        <UnitsPanel detail={detail} onCreated={(unitId) => navigate(`/units/${unitId}`)} />

        <section className="panel danger-zone">
          <h2>Delete property</h2>
          <p className="muted">Deletes the property, its units and all their information.</p>
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(`Delete ${detail.name} and all its units? This cannot be undone.`)
              ) {
                void run(async () => {
                  await host.deleteProperty(id);
                  navigate('/', { replace: true });
                });
              }
            }}
          >
            Delete property
          </button>
        </section>
      </div>
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
    <section className="panel">
      <h2>Units</h2>
      <p className="muted">
        {detail.approved
          ? 'Each unit has its own QR code for guests.'
          : 'Each unit gets its QR code once Fetivi approves the property.'}
      </p>
      {detail.units.length > 0 ? (
        <ul className="rows">
          {detail.units.map((u) => (
            <li key={u.id}>
              <Link to={`/units/${u.id}`} className="row-link compact">
                <strong>{u.name}</strong>
                <span className="muted with-icon">
                  <QrCode aria-hidden="true" />
                  {u.qrSlug ? 'QR code ready' : 'No QR code yet'}
                </span>
                <CaretRight aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <form className="inline-form" onSubmit={submit}>
        <TextField
          label="New unit name"
          placeholder="Apartment 1"
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
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
