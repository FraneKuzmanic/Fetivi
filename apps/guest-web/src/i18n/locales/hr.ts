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
  chat: {
    title: 'Razgovor',
    welcome:
      'Bok! Ja sam Fetivi, AI asistent za vaš boravak. Pitajte me o apartmanu, primjerice o Wi-Fiju, prijavi, kućnom redu ili kako što radi, i o okolici. Ako nešto ne znam, mogu za vas pitati domaćina.',
    you: 'Vi',
    fetivi: 'Fetivi',
    typing: 'Fetivi piše…',
    inputLabel: 'Poruka za Fetivija',
    placeholder: 'Pitajte me bilo što o boravku',
    send: 'Pošalji',
    closed: 'Vaš je boravak završio. Ovaj razgovor i dalje možete čitati.',
    startersLabel: 'Ideje za početak',
    starterWifi: 'Koja je lozinka za Wi-Fi?',
    starterTimes: 'Kada su prijava i odjava?',
    starterAccess: 'Kako da uđem?',
    starterRules: 'Koja su kućna pravila?',
    starterAround: 'Što se zanimljivo može raditi u blizini?',
    tripTitle: 'Recite mi nešto o svom putovanju',
    tripBody: 'Tko putuje i što volite? Zapamtit ću to. Ovo možete preskočiti.',
    tripStart: 'Krenimo',
    tripSkip: 'Preskoči',
    tripMessage: 'Želim vam reći nešto o našem putovanju.',
    errorTurn: 'Nešto nije u redu. Pokušajte ponovno.',
    errorBusy: 'Još odgovaram na vašu prethodnu poruku.',
    errorClosed: 'Vaš je boravak završio pa je razgovor sada samo za čitanje.',
    retry: 'Pokušaj ponovno',
  },
  common: {
    close: 'Zatvori',
    loading: 'Učitavanje…',
  },
  error: {
    network: 'Nema veze. Provjerite internet i pokušajte ponovno.',
  },
};
