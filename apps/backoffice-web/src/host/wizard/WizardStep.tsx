import {
  AMENITIES,
  BED_TYPES,
  CHECK_IN_METHODS,
  LIMITS,
  PARKING_TYPES,
} from '@fetivi/domain/vocabulary';
import {
  type WizardField as Field,
  fieldsOfStep,
  levelFor,
  WIZARD_STEP_IDS,
  type WizardLevel,
  type WizardPromptKey,
  type WizardStepId,
  wizardStepPath,
} from '@fetivi/domain/wizard';
import { CheckCircle, Plus, Trash } from '@phosphor-icons/react';
import { type FormEvent, useEffect, useId, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { host, type PropertyDetail, type UnitDetail, type WizardStatus } from '../../api';
import {
  CheckboxField,
  NumberField,
  SelectField,
  TextArea,
  TextField,
  TimeField,
  TriStateField,
} from '../../forms/fields';
import { useAction } from '../../useAction';
import { BlockPrompt } from './BlockPrompt';
import { format, useWizardCopy } from './copy';
import { LanguagePicker } from './LanguagePicker';
import {
  type DraftValues,
  fieldPatches,
  fieldTarget,
  loadedValues,
  same,
  toggledAmenities,
} from './targets';
import { WizardField } from './WizardField';
import { useStepState } from './WizardOverview';

const RELEASE_DAYS = ['0', '1', '2', '3', '4', '5', '6', '7'] as const;

/** The stepper: every step, the current one marked. Phones show the numbers only. */
function Stepper({ status, current }: { status: WizardStatus; current: WizardStepId }) {
  const { ui, steps } = useWizardCopy();
  const stepState = useStepState();
  return (
    <nav className="wizard-stepper" aria-label={ui.steps}>
      <Link to={`/units/${status.unitId}/setup`} className="stepper-overview">
        {ui.overview}
      </Link>
      <ol>
        {WIZARD_STEP_IDS.map((stepId, i) => {
          const done = stepState(status, stepId).tone === 'ok';
          return (
            <li key={stepId}>
              <Link
                to={wizardStepPath(status.unitId, stepId)}
                aria-current={stepId === current ? 'step' : undefined}
              >
                <span className="stepper-mark" aria-hidden="true">
                  {done ? <CheckCircle weight="fill" /> : i + 1}
                </span>
                <span className="stepper-title">{steps[stepId].title}</span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * One wizard step. Every way out (Back, Save and exit, Save and continue) saves the step first;
 * only changed fields are sent. Prompts save on their own, as Info blocks.
 */
export function WizardStep({
  stepId,
  status,
  detail,
  property,
  reload,
  manualPending,
}: {
  stepId: WizardStepId;
  status: WizardStatus;
  detail: UnitDetail;
  property: PropertyDetail;
  reload: () => Promise<void>;
  /** Drafts of this step from the house manual import, still to review. */
  manualPending: number;
}) {
  const copy = useWizardCopy();
  const { ui } = copy;
  const navigate = useNavigate();
  const { busy, error, run } = useAction();
  const formId = useId();
  const loaded = useMemo(() => loadedValues(detail, property), [detail, property]);
  const [draft, setDraft] = useState<DraftValues>(loaded);
  const [coords, setCoords] = useState({
    lat: loaded.location?.lat ?? null,
    lng: loaded.location?.lng ?? null,
  });
  const [amenities, setAmenities] = useState(property.amenities);

  const index = WIZARD_STEP_IDS.indexOf(stepId);
  const overviewPath = `/units/${detail.id}/setup`;
  const prevPath =
    index > 0 ? wizardStepPath(detail.id, WIZARD_STEP_IDS[index - 1] ?? stepId) : overviewPath;
  const nextStep = WIZARD_STEP_IDS[index + 1];
  const nextPath = nextStep ? wizardStepPath(detail.id, nextStep) : overviewPath;

  // The method in the draft, so choosing "Lockbox" shows the lockbox code at once.
  const levelOf = (field: Field) => levelFor(field, status.propertyType, draft.checkInMethod);
  const fields = fieldsOfStep(stepId).filter((f) => levelOf(f) !== 'hidden');
  const visible = new Set(fields.map((f) => f.id));
  const progress = status.progress.steps[stepId];

  // A deep link (#field-x) from Suggestions or the go-live checklist scrolls to the field.
  useEffect(() => {
    const target = window.location.hash.startsWith('#field-')
      ? document.getElementById(window.location.hash.slice(1))
      : null;
    if (!target) return;
    target.scrollIntoView({ block: 'start' });
    target
      .querySelector<HTMLElement>('input, select, textarea, button')
      ?.focus({ preventScroll: true });
  }, []);

  const set =
    <K extends keyof DraftValues>(key: K) =>
    (value: DraftValues[K]) =>
      setDraft((d) => ({ ...d, [key]: value }));

  function setCoord(axis: 'lat' | 'lng', value: number | null) {
    const next = { ...coords, [axis]: value };
    setCoords(next);
    // Both or neither; one alone is not saved.
    if (next.lat !== null && next.lng !== null) set('location')({ lat: next.lat, lng: next.lng });
    else if (next.lat === null && next.lng === null) set('location')(null);
  }

  async function save() {
    const patches = fieldPatches(stepId, visible, draft, loaded, detail);
    const amenitiesChanged = visible.has('amenities') && !same(amenities, property.amenities);
    if (patches.property) await host.updateProperty(detail.propertyId, patches.property);
    if (patches.unit) await host.updateUnit(detail.id, patches.unit);
    if (amenitiesChanged) await host.setPropertyAmenities(detail.propertyId, amenities);
    if (patches.property || patches.unit || amenitiesChanged) await reload();
  }

  const go = (path: string) =>
    void run(async () => {
      await save();
      navigate(path);
    });

  function submit(event: FormEvent) {
    event.preventDefault();
    go(nextPath);
  }

  const coreHint = (field: Field) =>
    field.kind !== 'core'
      ? undefined
      : fieldTarget(field, detail) === 'unit'
        ? ui.unitOnlyHint
        : format(ui.sharedHint, { property: property.name });

  function inputs(field: Field) {
    const label = copy.fields[field.id].label;
    switch (field.id) {
      case 'address':
        return (
          <>
            <TextField
              label={ui.addressLine}
              value={draft.addressLine}
              maxLength={LIMITS.shortText}
              onChange={set('addressLine')}
            />
            <div className="field-row">
              <TextField
                label={ui.postalCode}
                value={draft.postalCode}
                maxLength={LIMITS.shortText}
                onChange={set('postalCode')}
              />
              <TextField
                label={ui.city}
                value={draft.city}
                maxLength={LIMITS.shortText}
                onChange={set('city')}
              />
            </div>
          </>
        );
      case 'location':
        return (
          <div className="field-row">
            <NumberField
              label={ui.latitude}
              value={coords.lat}
              min={-90}
              max={90}
              step="any"
              onChange={(v) => setCoord('lat', v)}
            />
            <NumberField
              label={ui.longitude}
              value={coords.lng}
              min={-180}
              max={180}
              step="any"
              onChange={(v) => setCoord('lng', v)}
            />
          </div>
        );
      case 'check_in_time':
      case 'checkout_time': {
        const key = field.id === 'check_in_time' ? 'checkInTime' : 'checkoutTime';
        return <TimeField label={label} hideLabel value={draft[key]} onChange={set(key)} />;
      }
      case 'check_in_method':
        return (
          <SelectField
            label={label}
            hideLabel
            value={draft.checkInMethod}
            options={CHECK_IN_METHODS}
            labels={copy.checkInMethods}
            emptyLabel={ui.notSet}
            onChange={set('checkInMethod')}
          />
        );
      case 'access_instructions':
      case 'house_rules_notes': {
        const key = field.id === 'access_instructions' ? 'accessInstructions' : 'houseRulesNotes';
        return (
          <TextArea
            label={label}
            hideLabel
            value={draft[key]}
            maxLength={LIMITS.longText}
            onChange={set(key)}
          />
        );
      }
      case 'building_door_code':
      case 'door_code':
      case 'lockbox_code': {
        const key =
          field.id === 'building_door_code'
            ? 'buildingDoorCode'
            : field.id === 'door_code'
              ? 'doorCode'
              : 'lockboxCode';
        return (
          <TextField
            label={label}
            hideLabel
            value={draft[key]}
            maxLength={LIMITS.code}
            onChange={set(key)}
          />
        );
      }
      case 'arrival_release':
        return (
          <SelectField
            label={label}
            hideLabel
            value={String(draft.arrivalReleaseDaysBefore) as (typeof RELEASE_DAYS)[number]}
            options={RELEASE_DAYS}
            labels={
              Object.fromEntries(
                RELEASE_DAYS.map((d) => [
                  d,
                  d === '0'
                    ? ui.releaseSameDay
                    : d === '1'
                      ? ui.releaseOneDay
                      : format(ui.releaseDays, { n: d }),
                ]),
              ) as Record<(typeof RELEASE_DAYS)[number], string>
            }
            onChange={(v) => v && set('arrivalReleaseDaysBefore')(Number(v))}
          />
        );
      case 'wifi':
        return (
          <>
            <CheckboxField label={ui.noWifi} checked={draft.noWifi} onChange={set('noWifi')} />
            {draft.noWifi ? null : (
              <div className="field-row">
                <TextField
                  label={ui.wifiNetwork}
                  value={draft.wifiNetwork}
                  maxLength={LIMITS.shortText}
                  onChange={set('wifiNetwork')}
                />
                <TextField
                  label={ui.wifiPassword}
                  value={draft.wifiPassword}
                  maxLength={LIMITS.wifiPassword}
                  onChange={set('wifiPassword')}
                />
              </div>
            )}
          </>
        );
      case 'amenities':
        return <AmenityChecklist value={amenities} detail={detail} onChange={setAmenities} />;
      case 'parking':
        return (
          <>
            <SelectField
              label={ui.parkingType}
              value={draft.parkingType}
              options={PARKING_TYPES}
              labels={copy.parkingTypes}
              emptyLabel={ui.notSet}
              onChange={set('parkingType')}
            />
            <TextArea
              label={ui.parkingNotes}
              value={draft.parkingNotes}
              maxLength={LIMITS.longText}
              rows={2}
              onChange={set('parkingNotes')}
            />
          </>
        );
      case 'occupancy':
        return (
          <NumberField
            label={label}
            hideLabel
            value={draft.maxOccupancy}
            min={1}
            max={50}
            onChange={set('maxOccupancy')}
          />
        );
      case 'rooms_beds':
        return (
          <>
            <div className="field-row">
              {status.propertyType === 'room' || status.propertyType === 'studio' ? null : (
                <NumberField
                  label={ui.bedrooms}
                  value={draft.bedrooms}
                  min={0}
                  max={50}
                  onChange={set('bedrooms')}
                />
              )}
              <NumberField
                label={ui.bathrooms}
                value={draft.bathrooms}
                min={0}
                max={50}
                onChange={set('bathrooms')}
              />
            </div>
            <Beds beds={draft.beds} onChange={set('beds')} />
          </>
        );
      case 'house_rules':
        return (
          <div className="field-row">
            {(['petsAllowed', 'smokingAllowed', 'partiesAllowed'] as const).map((key) => (
              <TriStateField
                key={key}
                label={
                  key === 'petsAllowed'
                    ? ui.pets
                    : key === 'smokingAllowed'
                      ? ui.smoking
                      : ui.parties
                }
                value={draft[key]}
                nullLabel={ui.notSet}
                yesLabel={ui.yes}
                noLabel={ui.no}
                onChange={set(key)}
              />
            ))}
          </div>
        );
      case 'quiet_hours':
        return (
          <div className="field-row">
            <TimeField
              label={ui.quietFrom}
              value={draft.quietHoursFrom}
              onChange={set('quietHoursFrom')}
            />
            <TimeField
              label={ui.quietTo}
              value={draft.quietHoursTo}
              onChange={set('quietHoursTo')}
            />
          </div>
        );
      case 'licence_number':
        return (
          <TextField
            label={label}
            hideLabel
            value={draft.licenceNumber}
            maxLength={LIMITS.licence}
            onChange={set('licenceNumber')}
          />
        );
      case 'host_phone':
        return (
          <TextField
            label={label}
            hideLabel
            type="tel"
            value={draft.hostPhone}
            maxLength={LIMITS.phone}
            onChange={set('hostPhone')}
          />
        );
      case 'emergency_contact':
        return (
          <div className="field-row">
            <TextField
              label={ui.emergencyName}
              value={draft.emergencyContactName}
              maxLength={LIMITS.shortText}
              onChange={set('emergencyContactName')}
            />
            <TextField
              label={ui.emergencyPhone}
              type="tel"
              value={draft.emergencyContactPhone}
              maxLength={LIMITS.phone}
              onChange={set('emergencyContactPhone')}
            />
          </div>
        );
      default:
        return null;
    }
  }

  return (
    <div className="wizard-layout">
      <Stepper status={status} current={stepId} />
      <div className="wizard-content">
        <div className="wizard-step-top">
          <nav className="crumbs" aria-label="Breadcrumb">
            <Link to={`/units/${detail.id}`}>{detail.name}</Link>
            <span aria-hidden="true">/</span>
            <Link to={overviewPath}>{ui.setup}</Link>
          </nav>
          <LanguagePicker />
        </div>
        <header className="wizard-step-head">
          <span className="eyebrow">
            {format(ui.stepOf, { n: index + 1, total: WIZARD_STEP_IDS.length })}
          </span>
          <h1>{copy.steps[stepId].title}</h1>
          <p className="muted">{copy.steps[stepId].intro}</p>
          {progress.total > 0 ? (
            <div
              className="completeness-track"
              role="progressbar"
              aria-label={copy.steps[stepId].title}
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.filled}
            >
              <div
                className="completeness-fill"
                style={{ width: `${(100 * progress.filled) / progress.total}%` }}
              />
            </div>
          ) : null}
        </header>

        <div className="panel wizard-body">
          {manualPending > 0 ? (
            <div className="manual-notice" role="status">
              <span>{format(copy.manualImport.stepNotice, { n: manualPending })}</span>
              <Link to={`/units/${detail.id}/setup/import#step-${stepId}`}>
                {copy.manualImport.review}
              </Link>
            </div>
          ) : null}
          {stepId === 'saved_places' ? <p>{ui.savedPlacesInfo}</p> : null}
          <form id={formId} onSubmit={submit} className="wizard-form">
            {fields
              .filter((f) => f.kind !== 'prompt')
              .map((field) => (
                <WizardField
                  key={field.id}
                  id={field.id}
                  level={levelOf(field) as WizardLevel}
                  filled={status.fields[field.id]?.filled ?? false}
                  hint={coreHint(field)}
                >
                  {inputs(field)}
                </WizardField>
              ))}
          </form>
          {fields
            .filter((f) => f.kind === 'prompt')
            .map((field) => (
              <BlockPrompt
                key={field.id}
                promptKey={field.id as WizardPromptKey}
                level={levelOf(field) as WizardLevel}
                detail={detail}
                onSaved={reload}
              />
            ))}
        </div>

        <div className="wizard-footer">
          {error ? <p role="alert">{error}</p> : null}
          <div className="wizard-footer-actions">
            <button type="button" className="ghost" disabled={busy} onClick={() => go(prevPath)}>
              {ui.back}
            </button>
            <button type="button" disabled={busy} onClick={() => go(overviewPath)}>
              {ui.saveExit}
            </button>
            <button type="submit" form={formId} className="primary" disabled={busy}>
              {ui.saveContinue}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The property's amenities, ticked here; the unit's own additions show as fixed. */
function AmenityChecklist({
  value,
  detail,
  onChange,
}: {
  value: PropertyDetail['amenities'];
  detail: UnitDetail;
  onChange: (value: PropertyDetail['amenities']) => void;
}) {
  const copy = useWizardCopy();
  const onProperty = new Set(value.map((a) => a.amenity));
  const onUnit = new Set(detail.amenities.map((a) => a.amenity));
  return (
    <ul className="amenities">
      {AMENITIES.map((amenity) =>
        onUnit.has(amenity) && !onProperty.has(amenity) ? (
          <li key={amenity}>
            <CheckboxField
              label={
                <>
                  {copy.amenities[amenity]} <span className="muted">· {copy.ui.unitOnlyHint}</span>
                </>
              }
              checked
              disabled
              onChange={() => {}}
            />
          </li>
        ) : (
          <li key={amenity}>
            <CheckboxField
              label={copy.amenities[amenity]}
              checked={onProperty.has(amenity)}
              onChange={(on) => onChange(toggledAmenities(value, amenity, on))}
            />
          </li>
        ),
      )}
    </ul>
  );
}

function Beds({
  beds,
  onChange,
}: {
  beds: DraftValues['beds'];
  onChange: (beds: DraftValues['beds']) => void;
}) {
  const { ui, bedTypes } = useWizardCopy();
  return (
    <fieldset className="beds">
      <legend>{ui.beds}</legend>
      {beds.map((bed, i) => (
        // Rows have no identity of their own; the index is the row.
        // biome-ignore lint/suspicious/noArrayIndexKey: see above
        <div className="field-row bed-row" key={i}>
          <SelectField
            label={ui.bedType}
            value={bed.type}
            options={BED_TYPES}
            labels={bedTypes}
            onChange={(type) =>
              type && onChange(beds.map((b, j) => (j === i ? { ...b, type } : b)))
            }
          />
          <NumberField
            label={ui.bedCount}
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
            aria-label={ui.removeBed}
            onClick={() => onChange(beds.filter((_, j) => j !== i))}
          >
            <Trash aria-hidden="true" />
          </button>
        </div>
      ))}
      {beds.length < 10 ? (
        <button type="button" onClick={() => onChange([...beds, { type: 'double', count: 1 }])}>
          <Plus aria-hidden="true" weight="bold" />
          {ui.addBed}
        </button>
      ) : null}
    </fieldset>
  );
}
