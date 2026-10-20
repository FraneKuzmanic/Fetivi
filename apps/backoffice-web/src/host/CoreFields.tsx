import { CHECK_IN_METHODS, LIMITS, PARKING_TYPES } from '@fetivi/domain/vocabulary';
import type { CoreValues } from '../api';
import { SelectField, TextArea, TextField, TimeField, TriStateField } from '../forms/fields';
import { CHECK_IN_METHOD_LABELS, CORE_FIELD_LABELS, PARKING_LABELS } from '../forms/labels';

type CoreKey = keyof CoreValues;

/** The shared core fields, grouped as both editors show them. */
export const CORE_SECTIONS: { title: string; fields: readonly CoreKey[] }[] = [
  {
    title: 'Arrival and access',
    fields: ['checkInTime', 'checkoutTime', 'checkInMethod', 'accessInstructions'],
  },
  {
    title: 'House rules',
    fields: [
      'petsAllowed',
      'smokingAllowed',
      'partiesAllowed',
      'quietHoursFrom',
      'quietHoursTo',
      'houseRulesNotes',
    ],
  },
  { title: 'Parking', fields: ['parkingType', 'parkingNotes'] },
  { title: 'Contacts', fields: ['hostPhone', 'emergencyContactName', 'emergencyContactPhone'] },
  { title: 'Licence', fields: ['licenceNumber'] },
];

const TIMES = new Set<CoreKey>(['checkInTime', 'checkoutTime', 'quietHoursFrom', 'quietHoursTo']);
const BOOLEANS = new Set<CoreKey>(['petsAllowed', 'smokingAllowed', 'partiesAllowed']);
const LONG_TEXT = new Set<CoreKey>(['accessInstructions', 'parkingNotes', 'houseRulesNotes']);
const PHONES = new Set<CoreKey>(['hostPhone', 'emergencyContactPhone']);

/** A property value as the unit form shows it in a hint. */
export function formatCoreValue(key: CoreKey, value: CoreValues[CoreKey]): string {
  if (value === null) return 'not set';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (key === 'checkInMethod')
    return CHECK_IN_METHOD_LABELS[value as keyof typeof CHECK_IN_METHOD_LABELS];
  if (key === 'parkingType') return PARKING_LABELS[value as keyof typeof PARKING_LABELS];
  return value.length > 60 ? `${value.slice(0, 59)}…` : value;
}

/**
 * One shared core field. On a unit (`inherited` given) an empty field uses the property's value,
 * which the hint shows, and a set field can be handed back to the property.
 */
export function CoreField({
  field,
  value,
  onChange,
  inherited,
}: {
  field: CoreKey;
  value: CoreValues[CoreKey];
  onChange: (value: CoreValues[CoreKey]) => void;
  inherited?: CoreValues;
}) {
  const label = CORE_FIELD_LABELS[field];
  const fromProperty = inherited ? formatCoreValue(field, inherited[field]) : null;
  const hint =
    inherited === undefined ? undefined : value === null ? (
      <>Uses the property value: {fromProperty}</>
    ) : (
      <>
        Property value: {fromProperty}.{' '}
        <button type="button" className="link" onClick={() => onChange(null)}>
          Use property value
        </button>
      </>
    );
  const nullLabel = inherited ? 'Use property value' : 'Not set';
  const placeholder =
    inherited && typeof inherited[field] === 'string' ? (inherited[field] as string) : undefined;

  if (TIMES.has(field)) {
    return (
      <TimeField
        label={label}
        hint={hint}
        value={value as string | null}
        onChange={(v) => onChange(v)}
      />
    );
  }
  if (BOOLEANS.has(field)) {
    return (
      <TriStateField
        label={label}
        hint={hint}
        value={value as boolean | null}
        nullLabel={nullLabel}
        onChange={(v) => onChange(v)}
      />
    );
  }
  if (field === 'checkInMethod') {
    return (
      <SelectField
        label={label}
        hint={hint}
        value={value as CoreValues['checkInMethod']}
        options={CHECK_IN_METHODS}
        labels={CHECK_IN_METHOD_LABELS}
        emptyLabel={nullLabel}
        onChange={(v) => onChange(v)}
      />
    );
  }
  if (field === 'parkingType') {
    return (
      <SelectField
        label={label}
        hint={hint}
        value={value as CoreValues['parkingType']}
        options={PARKING_TYPES}
        labels={PARKING_LABELS}
        emptyLabel={nullLabel}
        onChange={(v) => onChange(v)}
      />
    );
  }
  if (LONG_TEXT.has(field)) {
    return (
      <TextArea
        label={label}
        hint={hint}
        value={value as string | null}
        maxLength={LIMITS.longText}
        placeholder={placeholder}
        onChange={(v) => onChange(v)}
      />
    );
  }
  return (
    <TextField
      label={label}
      hint={hint}
      type={PHONES.has(field) ? 'tel' : 'text'}
      value={value as string | null}
      maxLength={
        PHONES.has(field)
          ? LIMITS.phone
          : field === 'licenceNumber'
            ? LIMITS.licence
            : LIMITS.shortText
      }
      placeholder={placeholder}
      onChange={(v) => onChange(v)}
    />
  );
}
