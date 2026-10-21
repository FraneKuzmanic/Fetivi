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
  chat: {
    title: 'Chat',
    welcome:
      "Bok! Sono Fetivi, un assistente AI per il tuo soggiorno. Chiedimi dell'appartamento, per esempio il Wi-Fi, il check-in, le regole della casa o come funzionano le cose, e della zona intorno a te. Se non so qualcosa, posso chiederlo al tuo host per te.",
    you: 'Tu',
    fetivi: 'Fetivi',
    typing: 'Fetivi sta scrivendo…',
    inputLabel: 'Messaggio a Fetivi',
    placeholder: 'Chiedimi qualsiasi cosa sul soggiorno',
    send: 'Invia',
    closed: 'Il tuo soggiorno è terminato. Puoi ancora leggere questa chat.',
    startersLabel: 'Idee per iniziare',
    starterWifi: 'Qual è la password del Wi-Fi?',
    starterTimes: 'Quando sono il check-in e il check-out?',
    starterAccess: 'Come faccio a entrare?',
    starterRules: 'Quali sono le regole della casa?',
    starterAround: "Cosa c'è di bello da fare qui intorno?",
    tripTitle: 'Raccontami del tuo viaggio',
    tripBody: 'Chi viaggia e cosa ti piace? Lo terrò a mente. Puoi saltare questo passaggio.',
    tripStart: 'Iniziamo',
    tripSkip: 'Salta',
    tripMessage: 'Ti racconto del nostro viaggio.',
    errorTurn: 'Qualcosa è andato storto. Riprova.',
    errorBusy: 'Sto ancora rispondendo al tuo ultimo messaggio.',
    errorClosed: 'Il tuo soggiorno è terminato, quindi ora la chat è di sola lettura.',
    retry: 'Riprova',
  },
  common: {
    close: 'Chiudi',
    loading: 'Caricamento…',
  },
  error: {
    network: 'Nessuna connessione. Controlla internet e riprova.',
  },
};
