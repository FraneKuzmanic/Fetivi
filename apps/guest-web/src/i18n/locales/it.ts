// Machine-drafted, unreviewed. Check with a native speaker before the pilot.
import type { Messages } from './en';

export const it: Messages = {
  picker: {
    title: 'Scegli la lingua',
    mascot: 'Bok! Sono Fetivi. In che lingua parliamo?',
    yourLanguage: 'La lingua del tuo telefono',
  },
  pin: {
    title: 'Inserisci il PIN',
    hint: 'Il tuo host ti ha inviato un PIN di sei cifre.',
    label: 'PIN',
    submit: 'Continua',
    wrong: 'Questo PIN non corrisponde. Controlla il messaggio del tuo host e riprova.',
    wait: 'Troppi tentativi. Puoi riprovare tra {{time}}.',
    changeLanguage: 'Cambia lingua',
  },
  link: {
    notFound: "Questo link non funziona. Scansiona di nuovo il codice QR nell'appartamento.",
    none: "Apri il link che ti ha inviato il tuo host o scansiona il codice QR nell'appartamento.",
  },
  header: {
    language: 'Lingua',
    chooseLanguage: 'Scegli una lingua',
  },
  tabs: {
    label: 'Sezioni',
    chat: 'Chat',
    guide: 'Guida',
    trip: 'Il mio viaggio',
    unread: 'Non letti: {{count}}',
  },
  empty: {
    chat: 'Qui chatteremo. Arrivo presto.',
    guide: "Qui comparirà la guida all'appartamento e alla zona.",
    trip: 'Qui compariranno i piani del tuo viaggio.',
  },
  common: {
    close: 'Chiudi',
    loading: 'Caricamento…',
  },
  error: {
    network: 'Nessuna connessione. Controlla internet e riprova.',
  },
};
