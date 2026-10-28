import { CHECK_IN_METHODS, LIMITS, PARKING_TYPES } from '@fetivi/domain/vocabulary';
import { Car, type Icon, IdentificationCard, Key, Phone, Scroll } from '@phosphor-icons/react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CoreValues } from '../api';
import { SelectField, TextArea, TextField, TimeField, TriStateField } from '../forms/fields';
import { i18next } from '../i18n';
import { currentLabels, useLabels } from '../i18n/useLabels';

type CoreKey = keyof CoreValues;

/** The shared core fields, grouped as both editors show them. */
export const CORE_SECTIONS: { id: string; title: string; fields: readonly CoreKey[] }[] = [
  {
    id: 'arrival',
    get title() {
      return i18next.t('host:core.arrival');
    },
    fields: ['checkInTime', 'checkoutTime', 'checkInMethod', 'accessInstructions'],
  },
  {
    id: 'house-rules',
    get title() {
      return i18next.t('host:core.houseRules');
    },
    fields: [
      'petsAllowed',
      'smokingAllowed',
      'partiesAllowed',
      'quietHoursFrom',
      'quietHoursTo',
      'houseRulesNotes',
    ],
  },
  {
    id: 'parking',
    get title() {
      return i18next.t('host:core.parking');
    },
    fields: ['parkingType', 'parkingNotes'],
  },
  {
    id: 'contacts',
    get title() {
      return i18next.t('host:core.contacts');
    },
    fields: ['hostPhone', 'emergencyContactName', 'emergencyContactPhone'],
  },
  {
    id: 'licence',
    get title() {
      return i18next.t('host:core.licence');
    },
    fields: ['licenceNumber'],
  },
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
  const labels = currentLabels();
  if (value === null) return i18next.t('host:core.notSetOnProperty');
  if (typeof value === 'boolean') return value ? i18next.t('common:yes') : i18next.t('common:no');
  if (key === 'checkInMethod')
    return labels.checkInMethod[value as keyof typeof labels.checkInMethod];
  if (key === 'parkingType') return labels.parking[value as keyof typeof labels.parking];
  return value;
}

/** What a field is for, where the label alone leaves a host guessing. */
const hintOf = (field: CoreKey): string | null =>
  field === 'licenceNumber' ? i18next.t('host:core.licenceHint') : null;

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
  const { t } = useTranslation(['host', 'common']);
  const labels = useLabels();
  const [overriding, setOverriding] = useState(value !== null);
  const label = labels.coreField[field];

  if (!inherited) {
    return (
      <CoreInput
        field={field}
        value={value}
        onChange={onChange}
        hint={hintOf(field) ?? undefined}
      />
    );
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
            aria-label={t('core.setForUnitAria', { field: label.toLowerCase() })}
            onClick={() => {
              setOverriding(true);
              onChange(inherited[field]);
            }}
          >
            {t('core.setForUnit')}
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
          {hintOf(field) ? `${hintOf(field)} ` : null}
          {t('core.onlyThisUnit')}{' '}
          <button
            type="button"
            className="link"
            onClick={() => {
              setOverriding(false);
              onChange(null);
            }}
          >
            {t('core.useProperty')}
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
  const { t } = useTranslation(['host', 'common']);
  const labels = useLabels();
  const label = labels.coreField[field];
  const nullLabel = t('common:field.notSet');

  if (TIMES.has(field)) {
    return (
      <TimeField
        label={label}
        hint={hint ?? hintOf(field)}
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
        labels={labels.checkInMethod}
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
        labels={labels.parking}
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
