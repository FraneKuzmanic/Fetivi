// Machine-drafted, unreviewed. Check with a native speaker before the pilot.
import type { GuestCopy } from './types';

export const it: GuestCopy = {
  dateFormat: 'EEE d MMM',
  dateAtTime: '{{date}} alle {{time}}',
  kinds: {
    order_confirmed: {
      subject: 'Confermato: {{offer}}, {{date}}',
      lines: [
        'Buone notizie: {{offer}} del {{date}} è confermato.',
        'Trovi i dettagli in Il mio viaggio.',
      ],
      pushTitle: 'Confermato',
      pushBody: '{{offer}}, {{date}}',
    },
    order_new_proposal: {
      subject: 'Nuovo orario o prezzo per {{offer}}',
      lines: [
        'Il fornitore di {{offer}} ha proposto un orario o un prezzo diverso.',
        'Apri Il mio viaggio per accettare o rifiutare.',
      ],
      pushTitle: 'Nuova proposta',
      pushBody: '{{offer}}: dai un’occhiata',
    },
    order_cancelled: {
      subject: 'Annullato: {{offer}}, {{date}}',
      lines: ['{{offer}} del {{date}} è stato annullato.', 'Trovi i dettagli in Il mio viaggio.'],
      pushTitle: 'Annullato',
      pushBody: '{{offer}}, {{date}}',
    },
    order_declined: {
      subject: 'Non disponibile: {{offer}}, {{date}}',
      lines: [
        'Purtroppo il fornitore non può accettare la tua prenotazione per {{offer}} del {{date}}.',
        'In chat puoi chiedermi qualcos’altro.',
      ],
      pushTitle: 'Non disponibile',
      pushBody: '{{offer}}, {{date}}',
    },
    order_expired: {
      subject: 'Nessuna risposta in tempo: {{offer}}, {{date}}',
      lines: [
        'Il fornitore non ha risposto in tempo, quindi la tua richiesta per {{offer}} del {{date}} è chiusa.',
        'In chat puoi chiedermi qualcos’altro.',
      ],
      pushTitle: 'Richiesta chiusa',
      pushBody: '{{offer}}, {{date}}',
    },
    order_failed: {
      subject: 'Prenotazione non riuscita: {{offer}}, {{date}}',
      lines: [
        'Qualcosa è andato storto e non è stato possibile prenotare {{offer}} del {{date}}.',
        'Puoi riprovare o chiedermi in chat.',
      ],
      pushTitle: 'Prenotazione non riuscita',
      pushBody: '{{offer}}, {{date}}',
    },
    order_reminder: {
      subject: 'Domani: {{offer}}',
      lines: ['Promemoria: {{offer}} è domani, {{date}}.', 'Trovi i dettagli in Il mio viaggio.'],
      pushTitle: 'Domani',
      pushBody: '{{offer}}, {{date}}',
    },
    host_reply: {
      subject: 'Il tuo host ha risposto',
      lines: ['Il tuo host ha risposto al tuo messaggio.', 'Apri la chat per leggerlo.'],
      pushTitle: 'Il tuo host ha risposto',
      pushBody: 'Apri la chat per leggere la risposta.',
    },
    arrival_details: {
      subject: 'Le informazioni per l’arrivo sono pronte',
      lines: [
        'Le informazioni per l’arrivo sono pronte nella Guida: come entrare, il Wi-Fi e il resto.',
        'Buon viaggio!',
      ],
      pushTitle: 'Informazioni per l’arrivo pronte',
      pushBody: 'Apri la Guida per vedere come entrare.',
    },
    checkout_reminder: {
      subject: 'Il check-out è domani',
      lines: ['Ti ricordiamo che il check-out è domani.'],
      pushTitle: 'Il check-out è domani',
      pushBody: 'I passaggi per il check-out sono nella Guida.',
    },
    weather_warning: {
      subject: 'Allerta meteo del DHMZ ({{level}})',
      lines: [
        'Il DHMZ, il servizio meteorologico croato, ha emesso un’allerta meteo ({{level}}) per {{area}}, {{time}}:',
        '«{{event}}. {{description}}»',
      ],
      pushTitle: 'Allerta meteo DHMZ ({{level}})',
      pushBody: '{{event}}, {{time}}',
    },
    ferry_disruption: {
      subject: 'Avviso di Jadrolinija sulla linea {{lines}}',
      lines: [
        'L’avviso di Jadrolinija dice: «{{bulletinTitle}}»',
        'Potrebbe riguardare {{offer}} il {{date}} (linea {{lines}}). Leggi l’avviso prima di partire: {{bulletinUrl}}',
      ],
      pushTitle: 'Avviso Jadrolinija: linea {{lines}}',
      pushBody: '{{offer}}, {{date}}',
    },
  },
  warningLevels: { yellow: 'gialla', orange: 'arancione', red: 'rossa' },
  warningTime: '{{from}} – {{to}}',
  sailingAdvisory:
    'Le condizioni del mare potrebbero disturbare le corse sulla linea {{lines}} ({{offer}}, {{date}}). Prima di partire verifica con {{operator}}: {{operatorUrl}}',
  orderStands:
    'La tua prenotazione resta valida, a meno che il fornitore non la cancelli. Se succede, te lo dico subito.',
  sourceLine: 'Fonte: {{source}}, {{sourceUrl}}',
  checkoutTimeLine: 'Ti chiediamo di lasciare l’alloggio entro le {{checkoutTime}}.',
  reviewLine:
    'Se vuoi raccontare com’è andato il soggiorno, puoi lasciare una recensione su {{platform}}.',
  spaceEmails: {
    verify_email: {
      subject: 'Conferma la tua email per Fetivi',
      lines: [
        'Conferma che questa è la tua email. Così potrò inviarti aggiornamenti sul tuo soggiorno, come le risposte del tuo host.',
        'Il link è valido per 24 ore.',
      ],
      action: 'Conferma la mia email',
    },
    recover: {
      subject: 'Il tuo link per tornare su Fetivi',
      lines: [
        'Ecco il link per aprire il tuo Fetivi su questo o su un altro dispositivo, con la chat e le prenotazioni.',
        "Funziona una sola volta, per 1 ora. Se non l'hai chiesto tu, puoi ignorare questa email.",
      ],
      action: 'Apri il mio Fetivi',
    },
  },
  openApp: 'Apri Fetivi',
  signature: 'Fetivi',
};
