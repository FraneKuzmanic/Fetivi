import {
  AvailabilityPicker,
  ChoiceCard,
  FollowUpChips,
  HostMessageSent,
  PlaceCarousel,
  PropertyInfoCard,
  ReceiptCard,
} from '@fetivi/ui';
import { componentPart } from '@fetivi/ui/payloads';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { EmailOffer } from '../../email/EmailOffer';
import { mediaUrl } from '../../guide/guide-api';
import { propertyInfoLabels } from '../../guide/labels';
import { useInbox } from '../../inbox/InboxProvider';
import { AlertOffer } from '../../push/AlertOffer';
import {
  choiceLabels,
  hostSentLabels,
  pickedText,
  pickerLabels,
  placeLabels,
  receiptLabels,
} from './labels';
import { useSavedPlaces } from './SavedPlaces';

/**
 * One streamed component. The payload is checked again (a stored part may predate a schema
 * change); anything invalid or unknown renders nothing and the text carries the answer.
 */
export function ComponentPart({
  data,
  latest,
  onSend,
  onSomethingElse,
}: {
  data: unknown;
  /** True only on the newest answer while the guest can reply: chips and choices act only there. */
  latest: boolean;
  onSend: (text: string) => void;
  onSomethingElse: () => void;
}) {
  const { t, i18n } = useTranslation();
  const savedPlaces = useSavedPlaces();
  const inbox = useInbox();
  const parsed = useMemo(() => componentPart.safeParse(data), [data]);
  if (!parsed.success) return null;
  const part = parsed.data;
  switch (part.name) {
    case 'follow-up-chips':
      return latest ? (
        <FollowUpChips
          replies={part.payload.replies}
          label={t('components.followUps')}
          onSelect={onSend}
        />
      ) : null;
    case 'choice-card':
      return (
        <ChoiceCard
          question={part.payload.question}
          options={part.payload.options}
          multiple={part.payload.multiple}
          active={latest}
          onAnswer={onSend}
          onSomethingElse={onSomethingElse}
          labels={choiceLabels(t)}
        />
      );
    case 'place-carousel':
      return (
        <PlaceCarousel
          places={part.payload.places}
          saved={savedPlaces.saved}
          canSave={savedPlaces.canSave}
          onToggleSave={savedPlaces.toggle}
          labels={placeLabels(t, i18n.language)}
        />
      );
    case 'availability-picker': {
      const { date, starts } = part.payload;
      return (
        <AvailabilityPicker
          date={date}
          starts={starts}
          active={latest}
          // The guest's pick goes to Fetivi as their words; the model has the slot ids.
          onPick={(start) => onSend(pickedText(t, i18n.language, date, start.startsAtLocal))}
          labels={pickerLabels(t, i18n.language)}
        />
      );
    }
    case 'receipt-card':
      return <ReceiptCard order={part.payload.order} labels={receiptLabels(t, i18n.language)} />;
    case 'host-message-sent': {
      const { message } = part.payload;
      const status = inbox.status(message.id) ?? 'sent';
      return (
        <>
          <HostMessageSent
            message={message}
            status={status}
            labels={hostSentLabels(t, i18n.language)}
          />
          {status === 'sent' && (
            <>
              <AlertOffer />
              <EmailOffer />
            </>
          )}
        </>
      );
    }
    case 'property-info':
      return (
        <PropertyInfoCard
          info={part.payload}
          mediaUrl={mediaUrl}
          labels={propertyInfoLabels(t, i18n.language)}
        />
      );
  }
}
