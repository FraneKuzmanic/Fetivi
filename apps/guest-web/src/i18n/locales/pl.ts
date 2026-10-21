// Machine-drafted, unreviewed. Check with a native speaker before the pilot.
import type { Messages } from './en';

export const pl: Messages = {
  picker: {
    title: 'Wybierz język',
    mascot: 'Bok! Jestem Fetivi. W jakim języku rozmawiamy?',
    yourLanguage: 'Język Twojego telefonu',
  },
  pin: {
    title: 'Wpisz PIN',
    hint: 'Gospodarz wysłał Ci sześciocyfrowy PIN.',
    label: 'PIN',
    submit: 'Dalej',
    wrong: 'Ten PIN nie pasuje. Sprawdź wiadomość od gospodarza i spróbuj ponownie.',
    wait: 'Zbyt wiele prób. Możesz spróbować ponownie za {{time}}.',
    changeLanguage: 'Zmień język',
  },
  link: {
    notFound: 'Ten link nie działa. Zeskanuj ponownie kod QR w apartamencie.',
    none: 'Otwórz link od gospodarza albo zeskanuj kod QR w apartamencie.',
  },
  header: {
    language: 'Język',
    chooseLanguage: 'Wybierz język',
  },
  tabs: {
    label: 'Sekcje',
    chat: 'Czat',
    guide: 'Przewodnik',
    trip: 'Moja podróż',
    unread: 'Nieprzeczytane: {{count}}',
  },
  empty: {
    chat: 'Tu będziemy rozmawiać. Wkrótce się pojawię.',
    guide: 'Tu pojawi się przewodnik po apartamencie i okolicy.',
    trip: 'Tu pojawią się plany Twojej podróży.',
  },
  chat: {
    title: 'Czat',
    welcome:
      'Bok! Jestem Fetivi, asystent AI na czas Twojego pobytu. Pytaj mnie o apartament, na przykład o Wi-Fi, zameldowanie, zasady domu albo jak coś działa, a także o okolicę. Jeśli czegoś nie wiem, mogę zapytać za Ciebie gospodarza.',
    you: 'Ty',
    fetivi: 'Fetivi',
    typing: 'Fetivi pisze…',
    inputLabel: 'Wiadomość do Fetivi',
    placeholder: 'Zapytaj mnie o cokolwiek w sprawie pobytu',
    send: 'Wyślij',
    closed: 'Twój pobyt się zakończył. Nadal możesz czytać ten czat.',
    startersLabel: 'Pomysły na początek',
    starterWifi: 'Jakie jest hasło do Wi-Fi?',
    starterTimes: 'Kiedy jest zameldowanie i wymeldowanie?',
    starterAccess: 'Jak mam wejść?',
    starterRules: 'Jakie są zasady domu?',
    starterAround: 'Co ciekawego można robić w okolicy?',
    tripTitle: 'Opowiedz mi o swojej podróży',
    tripBody: 'Kto podróżuje i co lubicie? Zapamiętam to. Możesz to pominąć.',
    tripStart: 'Zaczynajmy',
    tripSkip: 'Pomiń',
    tripMessage: 'Opowiem Ci o naszej podróży.',
    errorTurn: 'Coś poszło nie tak. Spróbuj ponownie.',
    errorBusy: 'Wciąż odpowiadam na Twoją poprzednią wiadomość.',
    errorClosed: 'Twój pobyt się zakończył, więc czat jest teraz tylko do odczytu.',
    retry: 'Spróbuj ponownie',
  },
  common: {
    close: 'Zamknij',
    loading: 'Ładowanie…',
  },
  error: {
    network: 'Brak połączenia. Sprawdź internet i spróbuj ponownie.',
  },
};
