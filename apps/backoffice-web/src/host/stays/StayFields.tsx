import { STAY_LIMITS } from '@fetivi/domain/stay-vocabulary';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation(['host', 'common']);
  const set =
    <K extends keyof StayDraft>(key: K) =>
    (v: StayDraft[K]) =>
      onChange({ ...value, [key]: v });
  const showNights = value.checkIn && value.checkout && value.checkout > value.checkIn;

  return (
    <>
      <div className="field-row">
        <DateField
          label={t('stays.checkIn')}
          value={value.checkIn}
          required
          onChange={set('checkIn')}
        />
        <DateField
          label={t('stays.checkout')}
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
        label={t('stays.guests')}
        value={value.partySize}
        min={STAY_LIMITS.partySize.min}
        max={STAY_LIMITS.partySize.max}
        onChange={set('partySize')}
      />
      <div className="field-row">
        <TextField
          label={t('stays.bookerName')}
          hint={t('common:page.optional')}
          value={value.bookerName}
          maxLength={STAY_LIMITS.bookerName}
          onChange={set('bookerName')}
        />
        <TextField
          label={t('stays.reservationNumber')}
          hint={t('stays.reservationHint')}
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
