// Machine-drafted, unreviewed. Check with a native speaker before the pilot.
import type { Messages } from './en';

export const de: Messages = {
  picker: {
    title: 'Sprache wählen',
    mascot: 'Bok! Ich bin Fetivi. In welcher Sprache sollen wir sprechen?',
    yourLanguage: 'Sprache Ihres Telefons',
  },
  pin: {
    title: 'PIN eingeben',
    hint: 'Ihr Gastgeber hat Ihnen eine sechsstellige PIN geschickt.',
    label: 'PIN',
    submit: 'Weiter',
    wrong:
      'Diese PIN passt nicht. Prüfen Sie die Nachricht Ihres Gastgebers und versuchen Sie es erneut.',
    wait: 'Zu viele Versuche. Sie können es in {{time}} erneut versuchen.',
    changeLanguage: 'Sprache ändern',
  },
  link: {
    notFound: 'Dieser Link funktioniert nicht. Scannen Sie den QR-Code in der Wohnung erneut.',
    none: 'Öffnen Sie den Link Ihres Gastgebers oder scannen Sie den QR-Code in der Wohnung.',
  },
  header: {
    language: 'Sprache',
    chooseLanguage: 'Sprache wählen',
  },
  tabs: {
    label: 'Bereiche',
    chat: 'Chat',
    guide: 'Reiseführer',
    trip: 'Meine Reise',
    unread: '{{count}} ungelesen',
  },
  empty: {
    chat: 'Hier werden wir chatten. Ich bin bald da.',
    guide: 'Hier erscheint bald Ihr Führer zur Wohnung und zur Umgebung.',
    trip: 'Hier erscheinen bald Ihre Reisepläne.',
  },
  common: {
    close: 'Schließen',
    loading: 'Wird geladen…',
  },
  error: {
    network: 'Keine Verbindung. Prüfen Sie Ihr Internet und versuchen Sie es erneut.',
  },
};
