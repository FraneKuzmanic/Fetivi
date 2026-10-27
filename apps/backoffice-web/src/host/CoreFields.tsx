import { CHECK_IN_METHODS, LIMITS, PARKING_TYPES } from '@fetivi/domain/vocabulary';
import { Car, type Icon, IdentificationCard, Key, Phone, Scroll } from '@phosphor-icons/react';
import { type ReactNode, useState } from 'react';
import type { CoreValues } from '../api';
import { SelectField, TextArea, TextField, TimeField, TriStateField } from '../forms/fields';
import { CHECK_IN_METHOD_LABELS, CORE_FIELD_LABELS, PARKING_LABELS } from '../forms/labels';

type CoreKey = keyof CoreValues;

/** The shared core fields, grouped as both editors show them. */
export const CORE_SECTIONS: { id: string; title: string; fields: readonly CoreKey[] }[] = [
  {
    id: 'arrival',
    title: 'Arrival and access',
    fields: ['checkInTime', 'checkoutTime', 'checkInMethod', 'accessInstructions'],
  },
  {
    id: 'house-rules',
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
  { id: 'parking', title: 'Parking', fields: ['parkingType', 'parkingNotes'] },
  {
    id: 'contacts',
    title: 'Contacts',
    fields: ['hostPhone', 'emergencyContactName', 'emergencyContactPhone'],
  },
  { id: 'licence', title: 'Licence', fields: ['licenceNumber'] },
];

/** The icon each core section has in the property and unit section lists. */
export const CORE_SECTION_ICONS: Record<string, Icon> = {
  arrival: Key,
  'house-rules': Scroll,
  parking: Car,
  contacts: Phone,
  licence: IdentificationCard,
};

const TIMES = new Set<CoreKey>(['checkInTime', 'checkoutTime', 'quietHoursFrom', 'quietHoursTo']);
const BOOLEANS = new Set<CoreKey>(['petsAllowed', 'smokingAllowed', 'partiesAllowed']);
const LONG_TEXT = new Set<CoreKey>(['accessInstructions', 'parkingNotes', 'houseRulesNotes']);
const PHONES = new Set<CoreKey>(['hostPhone', 'emergencyContactPhone']);

/** A property value as the unit page shows it, in full. */
export function formatCoreValue(key: CoreKey, value: CoreValues[CoreKey]): string {
  if (value === null) return 'Not set on the property';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (key === 'checkInMethod')
    return CHECK_IN_METHOD_LABELS[value as keyof typeof CHECK_IN_METHOD_LABELS];
  if (key === 'parkingType') return PARKING_LABELS[value as keyof typeof PARKING_LABELS];
  return value;
}

/** What a field is for, where the label alone leaves a host guessing. */
const HINTS: Partial<Record<CoreKey, string>> = {
  licenceNumber:
    'The official registration number of the rental, for example 2181-03-01-24-0001. It shows guests the place is registered.',
};

/**
 * One shared core field. On a unit (`inherited` given) the property's value is shown as text
 * until the host sets one for this unit; a value set here can be handed back to the property.
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
  const [overriding, setOverriding] = useState(value !== null);
  const label = CORE_FIELD_LABELS[field];

  if (!inherited) {
    return <CoreInput field={field} value={value} onChange={onChange} hint={HINTS[field]} />;
  }

  if (!overriding && value === null) {
    const shown = formatCoreValue(field, inherited[field]);
    return (
      <div className="field inherited-field">
        <span className="field-label">{label}</span>
        <div className="inherited-value">
          <span className={inherited[field] === null ? 'muted' : 'inherited-text'}>{shown}</span>
          <button
            type="button"
            className="link-button"
            aria-label={`Set ${label.toLowerCase()} for this unit`}
            onClick={() => {
              setOverriding(true);
              onChange(inherited[field]);
            }}
          >
            Set for this unit
          </button>
        </div>
      </div>
    );
  }

  return (
    <CoreInput
      field={field}
      value={value}
      onChange={onChange}
      hint={
        <>
          {HINTS[field] ? `${HINTS[field]} ` : null}
          Only this unit.{' '}
          <button
            type="button"
            className="link"
            onClick={() => {
              setOverriding(false);
              onChange(null);
            }}
          >
            Use the property's value
          </button>
        </>
      }
    />
  );
}

function CoreInput({
  field,
  value,
  onChange,
  hint,
}: {
  field: CoreKey;
  value: CoreValues[CoreKey];
  onChange: (value: CoreValues[CoreKey]) => void;
  hint?: ReactNode;
}) {
  const label = CORE_FIELD_LABELS[field];
  const nullLabel = 'Not set';

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
      onChange={(v) => onChange(v)}
    />
  );
}
