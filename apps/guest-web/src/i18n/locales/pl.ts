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
  common: {
    close: 'Zamknij',
    loading: 'Ładowanie…',
  },
  error: {
    network: 'Brak połączenia. Sprawdź internet i spróbuj ponownie.',
  },
};
