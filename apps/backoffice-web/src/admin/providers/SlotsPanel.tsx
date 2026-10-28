import { OFFER_LIMITS } from '@fetivi/domain/offer-vocabulary';
import { Plus, Trash } from '@phosphor-icons/react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AllotmentSlot, SlotsClient } from '../../api';
import { formatDate } from '../../forms/datetime';
import { CheckboxField, NumberField, TimeField } from '../../forms/fields';
import { i18next } from '../../i18n';
import { currentLabels } from '../../i18n/useLabels';
import { useConfirm } from '../../shell/ConfirmDialog';
import { Pager } from '../../shell/Pager';
import { Tabs } from '../../shell/Tabs';
import { useAction } from '../../useAction';
import { InputField } from '../catalog/RowEditors';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
const short = (weekday: number) => (currentLabels().weekday[weekday as 1] ?? '').slice(0, 3);

/** 'YYYY-MM-DDTHH:mm' → 'Mon 04.01.2027, 09:00'. */
function startLine(local: string): string {
  const [date = '', time = ''] = local.split('T');
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
  return i18next.t('admin:slots.startLine', {
    weekday: short(weekday),
    date: formatDate(date),
    time: time.slice(0, 5),
  });
}

const PAGE = 30;

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
  const { t } = useTranslation(['admin', 'common', 'host']);
  const { busy, error, run } = useAction();
  const [past, setPast] = useState(false);
  const [offset, setOffset] = useState(0);
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
          ? t('slots.createdSkipped', { created, skipped })
          : t('slots.created', { created }),
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
        <h3>{t('slots.addFromSchedule')}</h3>
        <div className="field-row">
          <InputField
            label={t('slots.from')}
            type="date"
            value={draft.from}
            required
            onChange={(from) => setDraft((d) => ({ ...d, from }))}
          />
          <InputField
            label={t('slots.to')}
            type="date"
            value={draft.to}
            required
            onChange={(to) => setDraft((d) => ({ ...d, to }))}
          />
        </div>
        <fieldset className="weekdays">
          <legend>{t('slots.days')}</legend>
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
          <legend>{t('slots.startTimes')}</legend>
          {draft.times.map((time, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity of their own
            <div className="slot-time" key={i}>
              <TimeField
                label={t('slots.time', { n: i + 1 })}
                value={time}
                onChange={(v) => setTime(i, v)}
              />
              {draft.times.length > 1 ? (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t('slots.removeTime', { n: i + 1 })}
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
              {t('slots.addTime')}
            </button>
          ) : null}
        </fieldset>
        <NumberField
          label={t('slots.seatsPerSlot')}
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
            {t('slots.create')}
          </button>
        </div>
      </form>

      <h3>{t('slots.slots')}</h3>
      <Tabs
        label={t('slots.when')}
        items={[
          { id: 'upcoming', label: t('slots.upcoming') },
          { id: 'past', label: t('slots.past') },
        ]}
        value={past ? 'past' : 'upcoming'}
        onChange={(v) => {
          setPast(v === 'past');
          setOffset(0);
        }}
      />
      {error ? <p role="alert">{error}</p> : null}
      {slots === null ? <p className="muted">{t('common:loading')}</p> : null}
      {slots?.length === 0 ? (
        <p className="muted">{past ? t('slots.noPast') : t('slots.noUpcoming')}</p>
      ) : null}
      {slots && slots.length > 0 ? (
        <ul className="rows slot-list">
          <li className="slot-row slot-head" aria-hidden="true">
            <span>{t('slots.start')}</span>
            <span>{t('slots.seats')}</span>
            <span>{t('slots.left')}</span>
            <span />
          </li>
          {slots.slice(offset, offset + PAGE).map((slot) => (
            <SlotRow key={slot.id} slot={slot} client={client} onChanged={reload} />
          ))}
        </ul>
      ) : null}
      {slots && slots.length > PAGE ? (
        <Pager offset={offset} total={slots.length} size={PAGE} onChange={setOffset} />
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
  const { t } = useTranslation(['admin', 'common', 'host']);
  const { busy, error, run } = useAction();
  const confirm = useConfirm();
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
          label={t('slots.seatsOn', { start })}
          value={capacity}
          min={1}
          max={OFFER_LIMITS.capacityMax}
          onChange={setCapacity}
        />
        {/* Shown only for a changed value, so 60 rows don't carry 60 idle buttons. */}
        {capacity !== slot.capacity ? (
          <button type="submit" disabled={busy}>
            {t('common:save')}
          </button>
        ) : null}
      </form>
      <span className="slot-left">
        <span className="slot-label">{t('slots.leftLabel')}</span>
        {slot.remaining}
      </span>
      <button
        type="button"
        className="icon-button"
        aria-label={t('slots.deleteAria', { start })}
        disabled={busy}
        onClick={async () => {
          const yes = await confirm({
            title: t('slots.deleteTitle', { start }),
            body: slot.remaining < slot.capacity ? t('slots.booked') : t('slots.notBooked'),
            action: t('slots.deleteSlot'),
            danger: true,
          });
          if (!yes) return;
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
