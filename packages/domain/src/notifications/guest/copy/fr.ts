// Machine-drafted, unreviewed. Check with a native speaker before the pilot.
import type { GuestCopy } from './types';

export const fr: GuestCopy = {
  dateFormat: 'EEE d MMM',
  dateAtTime: '{{date}} à {{time}}',
  kinds: {
    order_confirmed: {
      subject: 'Confirmé : {{offer}}, {{date}}',
      lines: [
        'Bonne nouvelle : {{offer}} du {{date}} est confirmé.',
        'Vous trouverez les détails dans Mon séjour.',
      ],
      pushTitle: 'Confirmé',
      pushBody: '{{offer}}, {{date}}',
    },
    order_new_proposal: {
      subject: 'Nouvel horaire ou nouveau prix pour {{offer}}',
      lines: [
        'Le prestataire de {{offer}} propose un autre horaire ou un autre prix.',
        'Ouvrez Mon séjour pour accepter ou refuser.',
      ],
      pushTitle: 'Nouvelle proposition',
      pushBody: '{{offer}} : à consulter',
    },
    order_cancelled: {
      subject: 'Annulé : {{offer}}, {{date}}',
      lines: ['{{offer}} du {{date}} a été annulé.', 'Vous trouverez les détails dans Mon séjour.'],
      pushTitle: 'Annulé',
      pushBody: '{{offer}}, {{date}}',
    },
    order_declined: {
      subject: 'Indisponible : {{offer}}, {{date}}',
      lines: [
        'Désolé, le prestataire ne peut pas accepter votre réservation pour {{offer}} du {{date}}.',
        'Dans la discussion, vous pouvez me demander autre chose.',
      ],
      pushTitle: 'Indisponible',
      pushBody: '{{offer}}, {{date}}',
    },
    order_expired: {
      subject: 'Pas de réponse à temps : {{offer}}, {{date}}',
      lines: [
        'Le prestataire n’a pas répondu à temps, votre demande pour {{offer}} du {{date}} est donc close.',
        'Dans la discussion, vous pouvez me demander autre chose.',
      ],
      pushTitle: 'Demande close',
      pushBody: '{{offer}}, {{date}}',
    },
    order_checkout_expired: {
      subject: 'Non finalisé à temps : {{offer}}, {{date}}',
      lines: [
        'Le paiement pour {{offer}} du {{date}} n’a pas été finalisé à temps, la réservation est donc close et rien n’a été débité.',
        'Dans la discussion, vous pouvez me demander de réessayer.',
      ],
      pushTitle: 'Réservation close',
      pushBody: '{{offer}}, {{date}}',
    },
    order_failed: {
      subject: 'Réservation impossible : {{offer}}, {{date}}',
      lines: [
        'Un problème est survenu et {{offer}} du {{date}} n’a pas pu être réservé.',
        'Vous pouvez réessayer ou me demander dans la discussion.',
      ],
      pushTitle: 'Réservation impossible',
      pushBody: '{{offer}}, {{date}}',
    },
    order_reminder: {
      subject: 'Demain : {{offer}}',
      lines: [
        'Petit rappel : {{offer}}, c’est demain, {{date}}.',
        'Les détails sont dans Mon séjour.',
      ],
      pushTitle: 'Demain',
      pushBody: '{{offer}}, {{date}}',
    },
    host_reply: {
      subject: 'Votre hôte a répondu',
      lines: ['Votre hôte a répondu à votre message.', 'Ouvrez la discussion pour le lire.'],
      pushTitle: 'Votre hôte a répondu',
      pushBody: 'Ouvrez la discussion pour lire la réponse.',
    },
    arrival_details: {
      subject: 'Vos informations d’arrivée sont prêtes',
      lines: [
        'Vos informations d’arrivée sont prêtes dans le Guide : comment entrer, le Wi-Fi et le reste.',
        'Bon voyage !',
      ],
      pushTitle: 'Informations d’arrivée prêtes',
      pushBody: 'Ouvrez le Guide pour voir comment entrer.',
    },
    checkout_reminder: {
      subject: 'Le départ, c’est demain',
      lines: ['Petit rappel : le départ, c’est demain.'],
      pushTitle: 'Le départ, c’est demain',
      pushBody: 'Les étapes du départ sont dans le Guide.',
    },
    weather_warning: {
      subject: 'Alerte météo du DHMZ ({{level}})',
      lines: [
        'Le DHMZ, le service météorologique croate, a émis une alerte météo ({{level}}) pour {{area}}, {{time}} :',
        '« {{event}}. {{description}} »',
      ],
      pushTitle: 'Alerte météo DHMZ ({{level}})',
      pushBody: '{{event}}, {{time}}',
    },
    ferry_disruption: {
      subject: 'Avis de Jadrolinija sur la ligne {{lines}}',
      lines: [
        'L’avis de Jadrolinija dit : « {{bulletinTitle}} »',
        'Cela peut concerner {{offer}} le {{date}} (ligne {{lines}}). Lisez l’avis avant de partir : {{bulletinUrl}}',
      ],
      pushTitle: 'Avis Jadrolinija : ligne {{lines}}',
      pushBody: '{{offer}}, {{date}}',
    },
    daily_tip: {
      subject: 'Une idée pour demain : {{offer}}',
      // The rule's own lines (tipRules) are used instead.
      lines: [],
      pushTitle: 'Une idée pour demain',
      pushBody: '{{offer}}',
    },
  },
  warningLevels: { yellow: 'jaune', orange: 'orange', red: 'rouge' },
  warningTime: '{{from}} – {{to}}',
  sailingAdvisory:
    'L’état de la mer peut perturber les traversées sur la ligne {{lines}} ({{offer}}, {{date}}). Renseignez-vous auprès de {{operator}} avant de partir : {{operatorUrl}}',
  orderStands:
    'Votre réservation reste valable, sauf si le prestataire l’annule. Dans ce cas, je vous préviens tout de suite.',
  sourceLine: 'Source : {{source}}, {{sourceUrl}}',
  checkoutTimeLine: 'Merci de libérer le logement avant {{checkoutTime}}.',
  reviewLine:
    'Si vous souhaitez partager votre expérience, vous pouvez laisser un avis sur {{platform}}.',
  tipRules: {
    rain: [
      'Il devrait pleuvoir demain, {{date}}.',
      '{{offer}} est un bon endroit pour passer la journée{{distance}}.',
    ],
    event: ['Puisque vous aimez ce genre de choses : {{offer}} a lieu demain, {{date}}{{venue}}.'],
    gap: [
      'Demain, {{date}}, votre programme est encore libre.',
      'Pourquoi pas {{offer}}{{distance}} ? Demandez-moi, je vous en dirai plus.',
    ],
  },
  tipDistance: ' (à {{km}} km)',
  tipVenue: ', à {{venueName}}',
  tipUnsubscribe:
    'Vous recevez une idée par jour parce que vous l’avez demandé. Pour les arrêter en un clic :',
  spaceEmails: {
    verify_email: {
      subject: 'Confirmez votre e-mail pour Fetivi',
      lines: [
        "Merci de confirmer que c'est bien votre adresse e-mail. Je pourrai ensuite vous envoyer des nouvelles de votre séjour, comme les réponses de votre hôte.",
        'Le lien est valable 24 heures.',
      ],
      action: 'Confirmer mon e-mail',
    },
    recover: {
      subject: 'Votre lien pour revenir sur Fetivi',
      lines: [
        'Voici votre lien pour ouvrir votre Fetivi sur cet appareil ou un autre, avec votre conversation et vos réservations.',
        "Il fonctionne une seule fois, pendant 1 heure. Si vous ne l'avez pas demandé, vous pouvez ignorer cet e-mail.",
      ],
      action: 'Ouvrir mon Fetivi',
    },
  },
  openApp: 'Ouvrir Fetivi',
  signature: 'Fetivi',
};
