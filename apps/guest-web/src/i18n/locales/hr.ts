// Machine-drafted, unreviewed. Check with a native speaker before the pilot.
import type { Messages } from './en';

export const hr: Messages = {
  picker: {
    title: 'Odaberite jezik',
    mascot: 'Bok! Ja sam Fetivi. Na kojem ćemo jeziku razgovarati?',
    yourLanguage: 'Jezik vašeg mobitela',
  },
  pin: {
    title: 'Unesite PIN',
    hint: 'Domaćin vam je poslao šesteroznamenkasti PIN.',
    label: 'PIN',
    submit: 'Nastavi',
    wrong: 'Taj PIN ne odgovara. Provjerite poruku domaćina i pokušajte ponovno.',
    wait: 'Previše pokušaja. Ponovno možete pokušati za {{time}}.',
    changeLanguage: 'Promijeni jezik',
  },
  link: {
    notFound: 'Ova poveznica ne radi. Ponovno skenirajte QR kod u apartmanu.',
    none: 'Otvorite poveznicu koju vam je poslao domaćin ili skenirajte QR kod u apartmanu.',
  },
  header: {
    language: 'Jezik',
    chooseLanguage: 'Odaberite jezik',
  },
  tabs: {
    label: 'Odjeljci',
    chat: 'Razgovor',
    guide: 'Vodič',
    trip: 'Moje putovanje',
    unread: 'Nepročitano: {{count}}',
  },
  empty: {
    chat: 'Ovdje ćemo razgovarati. Uskoro sam tu.',
    guide: 'Ovdje će se pojaviti vodič kroz apartman i okolicu.',
    trip: 'Ovdje će se pojaviti planovi vašeg putovanja.',
  },
  common: {
    close: 'Zatvori',
    loading: 'Učitavanje…',
  },
  error: {
    network: 'Nema veze. Provjerite internet i pokušajte ponovno.',
  },
};
