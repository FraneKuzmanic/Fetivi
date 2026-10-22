// Machine-drafted, unreviewed. Check with a native speaker before the pilot.
import type { GuestCopy } from './types';

export const pl: GuestCopy = {
  dateFormat: 'EEE, d MMM',
  dateAtTime: '{{date}} o {{time}}',
  kinds: {
    order_confirmed: {
      subject: 'Potwierdzone: {{offer}}, {{date}}',
      lines: [
        'Dobra wiadomość: {{offer}} ({{date}}) jest potwierdzone.',
        'Szczegóły znajdziesz w zakładce Moja podróż.',
      ],
      pushTitle: 'Potwierdzone',
      pushBody: '{{offer}}, {{date}}',
    },
    order_new_proposal: {
      subject: 'Nowa godzina lub cena: {{offer}}',
      lines: [
        'Usługodawca {{offer}} zaproponował inną godzinę lub cenę.',
        'Otwórz Moja podróż, aby ją przyjąć lub odrzucić.',
      ],
      pushTitle: 'Nowa propozycja',
      pushBody: '{{offer}}: zobacz propozycję',
    },
    order_cancelled: {
      subject: 'Anulowane: {{offer}}, {{date}}',
      lines: [
        '{{offer}} ({{date}}) zostało anulowane.',
        'Szczegóły znajdziesz w zakładce Moja podróż.',
      ],
      pushTitle: 'Anulowane',
      pushBody: '{{offer}}, {{date}}',
    },
    order_declined: {
      subject: 'Niedostępne: {{offer}}, {{date}}',
      lines: [
        'Niestety usługodawca nie może przyjąć Twojej rezerwacji {{offer}} ({{date}}).',
        'Na czacie możesz zapytać mnie o coś innego.',
      ],
      pushTitle: 'Niedostępne',
      pushBody: '{{offer}}, {{date}}',
    },
    order_expired: {
      subject: 'Brak odpowiedzi na czas: {{offer}}, {{date}}',
      lines: [
        'Usługodawca nie odpowiedział na czas, więc Twoja prośba o {{offer}} ({{date}}) została zamknięta.',
        'Na czacie możesz zapytać mnie o coś innego.',
      ],
      pushTitle: 'Prośba zamknięta',
      pushBody: '{{offer}}, {{date}}',
    },
    order_failed: {
      subject: 'Nie udało się zarezerwować: {{offer}}, {{date}}',
      lines: [
        'Coś poszło nie tak i nie udało się zarezerwować {{offer}} ({{date}}).',
        'Możesz spróbować ponownie albo zapytać mnie na czacie.',
      ],
      pushTitle: 'Nie udało się zarezerwować',
      pushBody: '{{offer}}, {{date}}',
    },
    order_reminder: {
      subject: 'Jutro: {{offer}}',
      lines: [
        'Przypomnienie: {{offer}} jest jutro, {{date}}.',
        'Szczegóły znajdziesz w zakładce Moja podróż.',
      ],
      pushTitle: 'Jutro',
      pushBody: '{{offer}}, {{date}}',
    },
    host_reply: {
      subject: 'Gospodarz odpowiedział',
      lines: ['Gospodarz odpowiedział na Twoją wiadomość.', 'Otwórz czat, aby ją przeczytać.'],
      pushTitle: 'Gospodarz odpowiedział',
      pushBody: 'Otwórz czat, aby przeczytać odpowiedź.',
    },
    arrival_details: {
      subject: 'Informacje o przyjeździe są gotowe',
      lines: [
        'Informacje o przyjeździe czekają w Przewodniku: jak wejść, Wi-Fi i reszta.',
        'Szerokiej drogi!',
      ],
      pushTitle: 'Informacje o przyjeździe są gotowe',
      pushBody: 'Otwórz Przewodnik, aby zobaczyć, jak wejść.',
    },
    checkout_reminder: {
      subject: 'Wymeldowanie jest jutro',
      lines: ['Przypominamy, że wymeldowanie jest jutro.'],
      pushTitle: 'Wymeldowanie jest jutro',
      pushBody: 'Kroki wymeldowania znajdziesz w Przewodniku.',
    },
  },
  checkoutTimeLine: 'Prosimy o opuszczenie apartamentu do {{checkoutTime}}.',
  reviewLine:
    'Jeśli chcesz podzielić się wrażeniami z pobytu, możesz zostawić opinię na {{platform}}.',
  openApp: 'Otwórz Fetivi',
  signature: 'Fetivi',
};
