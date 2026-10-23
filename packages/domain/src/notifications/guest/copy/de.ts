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
    order_checkout_expired: {
      subject: 'Nicht rechtzeitig abgeschlossen: {{offer}}, {{date}}',
      lines: [
        'Die Zahlung für {{offer}} am {{date}} wurde nicht rechtzeitig abgeschlossen, daher ist die Buchung geschlossen und es wurde nichts belastet.',
        'Im Chat können Sie mich bitten, es noch einmal zu versuchen.',
      ],
      pushTitle: 'Buchung geschlossen',
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
    weather_warning: {
      subject: 'Wetterwarnung des DHMZ ({{level}})',
      lines: [
        'Der kroatische Wetterdienst DHMZ hat eine Wetterwarnung ({{level}}) für {{area}} herausgegeben, {{time}}:',
        '„{{event}}. {{description}}“',
      ],
      pushTitle: 'DHMZ-Wetterwarnung ({{level}})',
      pushBody: '{{event}}, {{time}}',
    },
    ferry_disruption: {
      subject: 'Jadrolinija-Hinweis zur Linie {{lines}}',
      lines: [
        'Der Hinweis von Jadrolinija lautet: „{{bulletinTitle}}“',
        'Das kann {{offer}} am {{date}} betreffen (Linie {{lines}}). Bitte lesen Sie den Hinweis, bevor Sie losfahren: {{bulletinUrl}}',
      ],
      pushTitle: 'Jadrolinija-Hinweis: Linie {{lines}}',
      pushBody: '{{offer}}, {{date}}',
    },
    daily_tip: {
      subject: 'Ein Tipp für morgen: {{offer}}',
      // The rule's own lines (tipRules) are used instead.
      lines: [],
      pushTitle: 'Ein Tipp für morgen',
      pushBody: '{{offer}}',
    },
  },
  warningLevels: { yellow: 'gelb', orange: 'orange', red: 'rot' },
  warningTime: '{{from}} – {{to}}',
  sailingAdvisory:
    'Der Seegang kann Fahrten auf der Linie {{lines}} stören ({{offer}}, {{date}}). Fragen Sie vor der Abfahrt bei {{operator}} nach: {{operatorUrl}}',
  orderStands:
    'Ihre Buchung bleibt bestehen, solange der Anbieter sie nicht storniert. Falls doch, sage ich Ihnen sofort Bescheid.',
  sourceLine: 'Quelle: {{source}}, {{sourceUrl}}',
  checkoutTimeLine: 'Bitte verlassen Sie die Unterkunft bis {{checkoutTime}} Uhr.',
  reviewLine:
    'Wenn Sie erzählen möchten, wie Ihr Aufenthalt war, können Sie eine Bewertung auf {{platform}} hinterlassen.',
  tipRules: {
    rain: [
      'Morgen, {{date}}, sieht es nach Regen aus.',
      '{{offer}} ist dann ein guter Ort{{distance}}.',
    ],
    event: ['Weil Sie so etwas mögen: {{offer}} findet morgen statt ({{date}}{{venue}}).'],
    gap: [
      'Morgen, {{date}}, ist in Ihrem Plan noch frei.',
      'Wie wäre es mit {{offer}}{{distance}}? Fragen Sie mich, dann erzähle ich Ihnen mehr.',
    ],
  },
  tipDistance: ' ({{km}} km entfernt)',
  tipVenue: ', {{venueName}}',
  tipUnsubscribe:
    'Sie bekommen einen Tipp am Tag, weil Sie das gewünscht haben. Mit einem Klick abbestellen:',
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
