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
  chat: {
    title: 'Chat',
    welcome:
      'Bok! Ich bin Fetivi, ein KI-Assistent für Ihren Aufenthalt. Fragen Sie mich zur Wohnung, etwa zum WLAN, zum Check-in, zur Hausordnung oder wie etwas funktioniert, und zur Umgebung. Wenn ich etwas nicht weiß, kann ich Ihren Gastgeber für Sie fragen.',
    you: 'Sie',
    fetivi: 'Fetivi',
    typing: 'Fetivi schreibt…',
    inputLabel: 'Nachricht an Fetivi',
    placeholder: 'Fragen Sie mich alles zu Ihrem Aufenthalt',
    send: 'Senden',
    closed: 'Ihr Aufenthalt ist zu Ende. Sie können diesen Chat weiterhin lesen.',
    startersLabel: 'Ideen für den Anfang',
    starterWifi: 'Wie lautet das WLAN-Passwort?',
    starterTimes: 'Wann sind Check-in und Check-out?',
    starterAccess: 'Wie komme ich hinein?',
    starterRules: 'Wie lautet die Hausordnung?',
    starterAround: 'Was kann man hier in der Nähe gut unternehmen?',
    tripTitle: 'Erzählen Sie mir von Ihrer Reise',
    tripBody:
      'Wer reist mit und was mögen Sie? Ich behalte es im Kopf. Sie können das überspringen.',
    tripStart: 'Los geht’s',
    tripSkip: 'Überspringen',
    tripMessage: 'Ich möchte Ihnen von unserer Reise erzählen.',
    errorTurn: 'Etwas ist schiefgelaufen. Versuchen Sie es erneut.',
    errorBusy: 'Ich beantworte noch Ihre letzte Nachricht.',
    errorClosed: 'Ihr Aufenthalt ist zu Ende, daher kann der Chat nur noch gelesen werden.',
    retry: 'Erneut versuchen',
  },
  common: {
    close: 'Schließen',
    loading: 'Wird geladen…',
  },
  error: {
    network: 'Keine Verbindung. Prüfen Sie Ihr Internet und versuchen Sie es erneut.',
  },
};
