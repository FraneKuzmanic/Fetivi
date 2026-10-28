import { AMENITIES, type Amenity, LIMITS } from '@fetivi/domain/vocabulary';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AmenityEntry, FieldTranslation } from '../api';
import { CheckboxField, Section } from '../forms/fields';
import { useLabels } from '../i18n/useLabels';
import { FieldTranslationStatus } from './translations/FieldTranslationStatus';

/**
 * Amenities from the controlled list, each with an optional note. On a unit, the property's
 * amenities are listed as inherited: a unit adds amenities, it cannot remove the property's.
 */
export function AmenitiesEditor({
  value,
  inherited = [],
  fieldTranslations = [],
  onTranslationChanged = async () => {},
  onSave,
}: {
  value: AmenityEntry[];
  inherited?: AmenityEntry[];
  /** The owner's amenity note translations (ticket 50), shown under each saved note. */
  fieldTranslations?: FieldTranslation[];
  onTranslationChanged?: () => Promise<void>;
  onSave: (amenities: AmenityEntry[]) => Promise<AmenityEntry[]>;
}) {
  const { t } = useTranslation(['host', 'common']);
  const labels = useLabels();
  const [notes, setNotes] = useState(() => new Map(value.map((a) => [a.amenity, a.note ?? ''])));
  const fromProperty = new Map(inherited.map((a) => [a.amenity, a.note]));

  function toggle(amenity: Amenity, on: boolean) {
    setNotes((current) => {
      const next = new Map(current);
      if (on) next.set(amenity, '');
      else next.delete(amenity);
      return next;
    });
  }

  async function save() {
    const list = AMENITIES.filter((a) => notes.has(a)).map((amenity) => ({
      amenity,
      note: notes.get(amenity)?.trim() || null,
    }));
    const saved = await onSave(list);
    setNotes(new Map(saved.map((a) => [a.amenity, a.note ?? ''])));
  }

  return (
    <Section
      title={t('core.amenities')}
      description={inherited.length > 0 ? t('core.amenitiesUnitHint') : t('core.amenitiesHint')}
      onSave={save}
    >
      <ul className="amenities">
        {AMENITIES.map((amenity) => {
          const inheritedNote = fromProperty.get(amenity);
          if (fromProperty.has(amenity) && !notes.has(amenity)) {
            return (
              <li key={amenity}>
                <CheckboxField
                  label={
                    <>
                      {labels.amenity[amenity]}{' '}
                      <span className="muted">{t('core.fromProperty')}</span>
                      {inheritedNote ? <span className="muted"> · {inheritedNote}</span> : null}
                    </>
                  }
                  checked
                  disabled
                  onChange={() => {}}
                />
              </li>
            );
          }
          const checked = notes.has(amenity);
          return (
            <li key={amenity}>
              <CheckboxField
                label={labels.amenity[amenity]}
                checked={checked}
                onChange={(on) => toggle(amenity, on)}
              />
              {checked ? (
                <input
                  aria-label={t('core.noteFor', { amenity: labels.amenity[amenity] })}
                  placeholder={t('core.notePlaceholder')}
                  maxLength={LIMITS.amenityNote}
                  value={notes.get(amenity) ?? ''}
                  onChange={(e) =>
                    setNotes((current) => new Map(current).set(amenity, e.target.value))
                  }
                />
              ) : null}
              {checked ? (
                <FieldTranslationStatus
                  translation={fieldTranslations.find((f) => f.amenity === amenity)}
                  onChanged={onTranslationChanged}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
