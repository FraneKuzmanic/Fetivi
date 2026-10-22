// Machine-drafted, unreviewed. Check with a native speaker before the pilot.
import type { GuestCopy } from './types';

export const de: GuestCopy = {
  dateFormat: 'EEE, d. MMM',
  dateAtTime: '{{date}} um {{time}}',
  kinds: {
    order_confirmed: {
      subject: 'Bestätigt: {{offer}}, {{date}}',
      lines: [
        'Gute Nachricht: {{offer}} am {{date}} ist bestätigt.',
        'Die Details finden Sie unter Meine Reise.',
      ],
      pushTitle: 'Bestätigt',
      pushBody: '{{offer}}, {{date}}',
    },
    order_new_proposal: {
      subject: 'Neue Zeit oder neuer Preis für {{offer}}',
      lines: [
        'Der Anbieter von {{offer}} schlägt eine andere Zeit oder einen anderen Preis vor.',
        'Öffnen Sie Meine Reise, um zuzustimmen oder abzulehnen.',
      ],
      pushTitle: 'Neuer Vorschlag',
      pushBody: '{{offer}}: bitte ansehen',
    },
    order_cancelled: {
      subject: 'Storniert: {{offer}}, {{date}}',
      lines: [
        '{{offer}} am {{date}} wurde storniert.',
        'Die Details finden Sie unter Meine Reise.',
      ],
      pushTitle: 'Storniert',
      pushBody: '{{offer}}, {{date}}',
    },
    order_declined: {
      subject: 'Nicht verfügbar: {{offer}}, {{date}}',
      lines: [
        'Leider kann der Anbieter Ihre Buchung für {{offer}} am {{date}} nicht annehmen.',
        'Im Chat können Sie mich nach etwas anderem fragen.',
      ],
      pushTitle: 'Nicht verfügbar',
      pushBody: '{{offer}}, {{date}}',
    },
    order_expired: {
      subject: 'Keine rechtzeitige Antwort: {{offer}}, {{date}}',
      lines: [
        'Der Anbieter hat nicht rechtzeitig geantwortet, daher ist Ihre Anfrage für {{offer}} am {{date}} geschlossen.',
        'Im Chat können Sie mich nach etwas anderem fragen.',
      ],
      pushTitle: 'Anfrage geschlossen',
      pushBody: '{{offer}}, {{date}}',
    },
    order_failed: {
      subject: 'Buchung nicht möglich: {{offer}}, {{date}}',
      lines: [
        'Etwas ist schiefgelaufen, {{offer}} am {{date}} konnte nicht gebucht werden.',
        'Sie können es erneut versuchen oder mich im Chat fragen.',
      ],
      pushTitle: 'Buchung nicht möglich',
      pushBody: '{{offer}}, {{date}}',
    },
    order_reminder: {
      subject: 'Morgen: {{offer}}',
      lines: [
        'Zur Erinnerung: {{offer}} ist morgen, {{date}}.',
        'Die Details finden Sie unter Meine Reise.',
      ],
      pushTitle: 'Morgen',
      pushBody: '{{offer}}, {{date}}',
    },
    host_reply: {
      subject: 'Ihr Gastgeber hat geantwortet',
      lines: [
        'Ihr Gastgeber hat auf Ihre Nachricht geantwortet.',
        'Öffnen Sie den Chat, um sie zu lesen.',
      ],
      pushTitle: 'Ihr Gastgeber hat geantwortet',
      pushBody: 'Öffnen Sie den Chat, um die Antwort zu lesen.',
    },
    arrival_details: {
      subject: 'Ihre Anreiseinfos sind bereit',
      lines: [
        'Ihre Anreiseinfos stehen im Reiseführer bereit: wie Sie hineinkommen, WLAN und mehr.',
        'Gute Reise!',
      ],
      pushTitle: 'Anreiseinfos sind bereit',
      pushBody: 'Im Reiseführer sehen Sie, wie Sie hineinkommen.',
    },
    checkout_reminder: {
      subject: 'Morgen ist Abreise',
      lines: ['Zur Erinnerung: Morgen ist Abreise.'],
      pushTitle: 'Morgen ist Abreise',
      pushBody: 'Die Schritte zur Abreise stehen im Reiseführer.',
    },
  },
  checkoutTimeLine: 'Bitte verlassen Sie die Unterkunft bis {{checkoutTime}} Uhr.',
  reviewLine:
    'Wenn Sie erzählen möchten, wie Ihr Aufenthalt war, können Sie eine Bewertung auf {{platform}} hinterlassen.',
  spaceEmails: {
    verify_email: {
      subject: 'Bestätigen Sie Ihre E-Mail für Fetivi',
      lines: [
        'Bitte bestätigen Sie, dass dies Ihre E-Mail-Adresse ist. Dann kann ich Ihnen Neuigkeiten zu Ihrem Aufenthalt schicken, zum Beispiel Antworten Ihres Gastgebers.',
        'Der Link ist 24 Stunden gültig.',
      ],
      action: 'E-Mail bestätigen',
    },
    recover: {
      subject: 'Ihr Link zurück zu Fetivi',
      lines: [
        'Mit diesem Link öffnen Sie Ihr Fetivi auf diesem oder einem anderen Gerät, mit Ihrem Chat und Ihren Buchungen.',
        'Er funktioniert einmal und 1 Stunde lang. Wenn Sie ihn nicht angefordert haben, können Sie diese E-Mail ignorieren.',
      ],
      action: 'Mein Fetivi öffnen',
    },
  },
  openApp: 'Fetivi öffnen',
  signature: 'Fetivi',
};
