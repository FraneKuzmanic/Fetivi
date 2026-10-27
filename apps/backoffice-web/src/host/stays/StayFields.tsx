import { STAY_LIMITS } from '@fetivi/domain/stay-vocabulary';
import { DateField, NumberField, TextField } from '../../forms/fields';
import { nightsLabel } from './format';

export interface StayDraft {
  checkIn: string | null;
  checkout: string | null;
  partySize: number | null;
  bookerName: string | null;
  reservationNumber: string | null;
}

/** The date, party and booker fields shared by the register and edit forms. */
export function StayFields({
  value,
  onChange,
}: {
  value: StayDraft;
  onChange: (next: StayDraft) => void;
}) {
  const set =
    <K extends keyof StayDraft>(key: K) =>
    (v: StayDraft[K]) =>
      onChange({ ...value, [key]: v });
  const showNights = value.checkIn && value.checkout && value.checkout > value.checkIn;

  return (
    <>
      <div className="field-row">
        <DateField label="Check-in" value={value.checkIn} required onChange={set('checkIn')} />
        <DateField
          label="Checkout"
          value={value.checkout}
          min={value.checkIn ?? undefined}
          required
          onChange={set('checkout')}
        />
      </div>
      {showNights ? (
        <p className="muted">{nightsLabel(value.checkIn ?? '', value.checkout ?? '')}</p>
      ) : null}
      <NumberField
        label="Guests"
        value={value.partySize}
        min={STAY_LIMITS.partySize.min}
        max={STAY_LIMITS.partySize.max}
        onChange={set('partySize')}
      />
      <div className="field-row">
        <TextField
          label="Booker name"
          hint="Optional. Only you see this."
          value={value.bookerName}
          maxLength={STAY_LIMITS.bookerName}
          onChange={set('bookerName')}
        />
        <TextField
          label="Reservation number"
          hint="Optional. The number from Airbnb or Booking.com."
          value={value.reservationNumber}
          maxLength={STAY_LIMITS.reservationNumber}
          onChange={set('reservationNumber')}
        />
      </div>
    </>
  );
}

/** The API body for a draft; the browser's `required` keeps the dates filled. */
export function stayBody(draft: StayDraft) {
  return {
    checkIn: draft.checkIn ?? '',
    checkout: draft.checkout ?? '',
    partySize: draft.partySize ?? 0,
    bookerName: draft.bookerName,
    reservationNumber: draft.reservationNumber,
  };
}
