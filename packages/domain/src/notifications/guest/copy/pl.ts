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
    weather_warning: {
      subject: 'Ostrzeżenie pogodowe DHMZ ({{level}})',
      lines: [
        'DHMZ, chorwacka służba meteorologiczna, wydała ostrzeżenie pogodowe ({{level}}) dla obszaru {{area}}, {{time}}:',
        '„{{event}}. {{description}}”',
      ],
      pushTitle: 'Ostrzeżenie pogodowe DHMZ ({{level}})',
      pushBody: '{{event}}, {{time}}',
    },
    ferry_disruption: {
      subject: 'Komunikat Jadrolinii o linii {{lines}}',
      lines: [
        'Komunikat Jadrolinii brzmi: „{{bulletinTitle}}”',
        'Może to dotyczyć: {{offer}}, {{date}} (linia {{lines}}). Przeczytaj komunikat przed wyjazdem: {{bulletinUrl}}',
      ],
      pushTitle: 'Komunikat Jadrolinii: linia {{lines}}',
      pushBody: '{{offer}}, {{date}}',
    },
  },
  warningLevels: { yellow: 'żółte', orange: 'pomarańczowe', red: 'czerwone' },
  warningTime: '{{from}} – {{to}}',
  sailingAdvisory:
    'Warunki na morzu mogą zakłócić rejsy na linii {{lines}} ({{offer}}, {{date}}). Przed wyjazdem sprawdź u przewoźnika {{operator}}: {{operatorUrl}}',
  orderStands:
    'Twoja rezerwacja pozostaje bez zmian, chyba że usługodawca ją odwoła. Jeśli tak się stanie, od razu dam Ci znać.',
  sourceLine: 'Źródło: {{source}}, {{sourceUrl}}',
  checkoutTimeLine: 'Prosimy o opuszczenie apartamentu do {{checkoutTime}}.',
  reviewLine:
    'Jeśli chcesz podzielić się wrażeniami z pobytu, możesz zostawić opinię na {{platform}}.',
  spaceEmails: {
    verify_email: {
      subject: 'Potwierdź swój e-mail w Fetivi',
      lines: [
        'Potwierdź, że to Twój adres e-mail. Wtedy będę mógł wysyłać Ci informacje o Twoim pobycie, na przykład odpowiedzi gospodarza.',
        'Link jest ważny przez 24 godziny.',
      ],
      action: 'Potwierdź mój e-mail',
    },
    recover: {
      subject: 'Twój link powrotny do Fetivi',
      lines: [
        'Oto link, który otworzy Twoje Fetivi na tym lub innym urządzeniu, z czatem i rezerwacjami.',
        'Działa jeden raz, przez 1 godzinę. Jeśli o niego nie prosiłeś, zignoruj tę wiadomość.',
      ],
      action: 'Otwórz moje Fetivi',
    },
  },
  openApp: 'Otwórz Fetivi',
  signature: 'Fetivi',
};
