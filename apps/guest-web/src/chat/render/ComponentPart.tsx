import {
  AvailabilityPicker,
  ChoiceCard,
  DayPlan,
  EventList,
  FollowUpChips,
  HostMessageSent,
  PlaceCarousel,
  PropertyInfoCard,
  ReceiptCard,
  SourceRow,
  WeatherCard,
} from '@fetivi/ui';
import { componentPart, type OrderSummaryPayload } from '@fetivi/ui/payloads';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { EmailOffer } from '../../email/EmailOffer';
import { mediaUrl } from '../../guide/guide-api';
import { propertyInfoLabels } from '../../guide/labels';
import { useInbox } from '../../inbox/InboxProvider';
import { usePay } from '../../my-trip/orders/orders-api';
import { AlertOffer } from '../../push/AlertOffer';
import { useSpace } from '../../space';
import {
  choiceLabels,
  eventLabels,
  hostSentLabels,
  pickedText,
  pickerLabels,
  placeLabels,
  planLabels,
  receiptLabels,
  sourceRowLabels,
  weatherLabels,
} from './labels';
import { useSavedPlaces } from './SavedPlaces';

/**
 * A receipt in the chat. It is a stored part, so its `payBy` is from when the guest tapped: on
 * Pay now the server decides, and a closed window says so here.
 */
function ReceiptPart({ order }: { order: OrderSummaryPayload }) {
  const { t, i18n } = useTranslation();
  const { paying, notice, pay } = usePay();
  return (
    <ReceiptCard
      order={order}
      labels={receiptLabels(t, i18n.language)}
      onPay={(id) => void pay(id)}
      paying={paying === order.id}
      notice={notice ? t(notice.key) : null}
    />
  );
}

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
  const { changeLanguage } = useSpace();
  const parsed = useMemo(() => componentPart.safeParse(data), [data]);
  if (!parsed.success) return null;
  const part = parsed.data;
  switch (part.name) {
    case 'follow-up-chips': {
      const target = part.payload.switchLanguage;
      // The guest wrote in another of Fetivi's languages: one tap switches Fetivi, through the
      // same path as Settings (ticket 63). Once switched, the chip is gone by itself.
      const switchTo =
        target && target !== i18n.language
          ? {
              label: t('components.switchLanguage', { lng: target }),
              lang: target,
              onSelect: () => void changeLanguage(target),
            }
          : undefined;
      return latest ? (
        <FollowUpChips
          replies={part.payload.replies}
          label={t('components.followUps')}
          onSelect={onSend}
          switchTo={switchTo}
        />
      ) : null;
    }
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
    case 'event-list':
      return (
        <EventList
          events={part.payload.events}
          labels={eventLabels(t, i18n.language)}
          locale={i18n.language}
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
      return <ReceiptPart order={part.payload.order} />;
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
    case 'day-plan':
      // No Ask button: the guest is already in the chat. Empty days show for a one-day read, or
      // when nothing is planned at all, so the timeline is never blank.
      return (
        <DayPlan
          days={part.payload.days}
          today={part.payload.today}
          labels={planLabels(t, i18n.language)}
          showEmptyDays={
            part.payload.days.length === 1 || part.payload.days.every((d) => d.items.length === 0)
          }
        />
      );
    case 'weather':
      return <WeatherCard report={part.payload} labels={weatherLabels(t, i18n.language)} />;
    case 'web-results':
      // Shown only for results the answer never cited (see MessageList): one row of site links,
      // never place cards, nothing to save or book.
      return <SourceRow results={part.payload.results} labels={sourceRowLabels(t)} />;
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
