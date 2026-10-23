import { OFFER_LIMITS } from '@fetivi/domain/offer-vocabulary';
import { Plus, Trash } from '@phosphor-icons/react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import type { AllotmentSlot, SlotsClient } from '../../api';
import { CheckboxField, NumberField, TimeField } from '../../forms/fields';
import { WEEKDAY_LABELS } from '../../forms/labels';
import { useAction } from '../../useAction';
import { InputField } from '../catalog/RowEditors';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
const short = (weekday: number) => (WEEKDAY_LABELS[weekday] ?? '').slice(0, 3);

/** 'YYYY-MM-DDTHH:mm' → 'Mon 2027-01-04 09:00'. */
function startLine(local: string): string {
  const [date = '', time = ''] = local.split('T');
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
  return `${short(weekday)} ${date} ${time}`;
}

interface BulkDraft {
  from: string | null;
  to: string | null;
  weekdays: number[];
  times: (string | null)[];
  capacity: number | null;
}

/**
 * Allotment slots of an Offer: bulk creation from a weekly schedule, then per-slot edits. The
 * client is the admin's Offer routes or the host's own-service routes (38).
 */
export function SlotsPanel({
  offerId,
  timezone,
  client,
}: {
  offerId: string;
  timezone: string;
  client: SlotsClient;
}) {
  const { busy, error, run } = useAction();
  const [past, setPast] = useState(false);
  const [slots, setSlots] = useState<AllotmentSlot[] | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [draft, setDraft] = useState<BulkDraft>({
    from: null,
    to: null,
    weekdays: WEEKDAYS,
    times: ['09:00'],
    capacity: 12,
  });

  const reload = useCallback(
    async () => setSlots((await client.slots(offerId, past)).slots),
    [offerId, past, client],
  );

  useEffect(() => {
    void run(reload);
  }, [run, reload]);

  function create(event: FormEvent) {
    event.preventDefault();
    setResult(null);
    void run(async () => {
      const { created, skipped } = await client.bulkSlots(offerId, {
        from: draft.from ?? '',
        to: draft.to ?? '',
        weekdays: draft.weekdays,
        times: draft.times.filter((t): t is string => t !== null),
        capacity: draft.capacity ?? 0,
      });
      setResult(
        skipped > 0
          ? `Created ${created}, skipped ${skipped} (already there, in the past, or skipped by a clock change).`
          : `Created ${created}.`,
      );
      await reload();
    });
  }

  const toggleDay = (day: number, on: boolean) =>
    setDraft((d) => ({
      ...d,
      weekdays: on
        ? [...d.weekdays, day].sort((a, b) => a - b)
        : d.weekdays.filter((x) => x !== day),
    }));
  const setTime = (i: number, value: string | null) =>
    setDraft((d) => ({ ...d, times: d.times.map((t, j) => (j === i ? value : t)) }));

  return (
    <div className="slots">
      <form className="slots-bulk" onSubmit={create}>
        <h3>Add slots from a weekly schedule</h3>
        <div className="field-row">
          <InputField
            label="From"
            type="date"
            value={draft.from}
            required
            onChange={(from) => setDraft((d) => ({ ...d, from }))}
          />
          <InputField
            label="To"
            type="date"
            value={draft.to}
            required
            onChange={(to) => setDraft((d) => ({ ...d, to }))}
          />
        </div>
        <fieldset className="weekdays">
          <legend>Days</legend>
          {WEEKDAYS.map((day) => (
            <CheckboxField
              key={day}
              label={short(day)}
              checked={draft.weekdays.includes(day)}
              onChange={(on) => toggleDay(day, on)}
            />
          ))}
        </fieldset>
        <fieldset className="row-editor">
          <legend>Start times</legend>
          {draft.times.map((time, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity of their own
            <div className="slot-time" key={i}>
              <TimeField label={`Time ${i + 1}`} value={time} onChange={(v) => setTime(i, v)} />
              {draft.times.length > 1 ? (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove time ${i + 1}`}
                  onClick={() =>
                    setDraft((d) => ({ ...d, times: d.times.filter((_, j) => j !== i) }))
                  }
                >
                  <Trash aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ))}
          {draft.times.length < OFFER_LIMITS.slotTimesPerDay ? (
            <button
              type="button"
              onClick={() => setDraft((d) => ({ ...d, times: [...d.times, null] }))}
            >
              <Plus aria-hidden="true" weight="bold" />
              Add time
            </button>
          ) : null}
        </fieldset>
        <NumberField
          label="Seats per slot"
          value={draft.capacity}
          min={1}
          max={OFFER_LIMITS.capacityMax}
          onChange={(capacity) => setDraft((d) => ({ ...d, capacity }))}
        />
        <small>Times in {timezone}. Up to a year at a time.</small>
        <div className="section-foot">
          {result ? (
            <output className="saved" aria-live="polite">
              {result}
            </output>
          ) : null}
          <button type="submit" className="primary" disabled={busy}>
            Create slots
          </button>
        </div>
      </form>

      <div className="page-head">
        <h3>Slots</h3>
        <div className="segmented" role="tablist" aria-label="When">
          <button type="button" role="tab" aria-selected={!past} onClick={() => setPast(false)}>
            Upcoming
          </button>
          <button type="button" role="tab" aria-selected={past} onClick={() => setPast(true)}>
            Past
          </button>
        </div>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {slots === null ? <p className="muted">Loading…</p> : null}
      {slots?.length === 0 ? (
        <p className="muted">{past ? 'No past slots.' : 'No upcoming slots.'}</p>
      ) : null}
      {slots && slots.length > 0 ? (
        <ul className="rows slot-list">
          <li className="slot-row slot-head" aria-hidden="true">
            <span>Start</span>
            <span>Seats</span>
            <span>Left</span>
            <span />
          </li>
          {slots.map((slot) => (
            <SlotRow key={slot.id} slot={slot} client={client} onChanged={reload} />
          ))}
        </ul>
      ) : null}
      <small>Times in {timezone}.</small>
    </div>
  );
}

function SlotRow({
  slot,
  client,
  onChanged,
}: {
  slot: AllotmentSlot;
  client: SlotsClient;
  onChanged: () => Promise<void>;
}) {
  const { busy, error, run } = useAction();
  const [capacity, setCapacity] = useState<number | null>(slot.capacity);
  const start = startLine(slot.startsAt);

  return (
    <li className="slot-row">
      <strong>{start}</strong>
      <form
        className="slot-capacity"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await client.setSlotCapacity(slot.id, capacity ?? 0);
            await onChanged();
          });
        }}
      >
        <NumberField
          label={`Seats on ${start}`}
          value={capacity}
          min={1}
          max={OFFER_LIMITS.capacityMax}
          onChange={setCapacity}
        />
        {/* Shown only for a changed value, so 60 rows don't carry 60 idle buttons. */}
        {capacity !== slot.capacity ? (
          <button type="submit" disabled={busy}>
            Save
          </button>
        ) : null}
      </form>
      <span className="slot-left">
        <span className="slot-label">Left: </span>
        {slot.remaining}
      </span>
      <button
        type="button"
        className="icon-button"
        aria-label={`Delete slot ${start}`}
        disabled={busy}
        onClick={() => {
          if (!window.confirm(`Delete the slot on ${start}?`)) return;
          void run(async () => {
            await client.deleteSlot(slot.id);
            await onChanged();
          });
        }}
      >
        <Trash aria-hidden="true" />
      </button>
      {error ? (
        <p role="alert" className="slot-error">
          {error}
        </p>
      ) : null}
    </li>
  );
}
