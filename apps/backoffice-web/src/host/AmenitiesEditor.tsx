import { AMENITIES, type Amenity, LIMITS } from '@fetivi/domain/vocabulary';
import { useState } from 'react';
import type { AmenityEntry } from '../api';
import { CheckboxField, Section } from '../forms/fields';
import { AMENITY_LABELS } from '../forms/labels';

/**
 * Amenities from the controlled list, each with an optional note. On a unit, the property's
 * amenities are listed as inherited: a unit adds amenities, it cannot remove the property's.
 */
export function AmenitiesEditor({
  value,
  inherited = [],
  onSave,
}: {
  value: AmenityEntry[];
  inherited?: AmenityEntry[];
  onSave: (amenities: AmenityEntry[]) => Promise<AmenityEntry[]>;
}) {
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
      title="Amenities"
      description={
        inherited.length > 0
          ? 'Amenities of the property apply to this unit too. Add what only this unit has.'
          : 'Tick what guests can use. A note is optional, for example "Heated May to October".'
      }
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
                      {AMENITY_LABELS[amenity]} <span className="muted">· from property</span>
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
                label={AMENITY_LABELS[amenity]}
                checked={checked}
                onChange={(on) => toggle(amenity, on)}
              />
              {checked ? (
                <input
                  aria-label={`Note for ${AMENITY_LABELS[amenity]}`}
                  placeholder="Note (optional)"
                  maxLength={LIMITS.amenityNote}
                  value={notes.get(amenity) ?? ''}
                  onChange={(e) =>
                    setNotes((current) => new Map(current).set(amenity, e.target.value))
                  }
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
