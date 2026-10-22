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
  },
  checkoutTimeLine: 'Merci de libérer le logement avant {{checkoutTime}}.',
  reviewLine:
    'Si vous souhaitez partager votre expérience, vous pouvez laisser un avis sur {{platform}}.',
  openApp: 'Ouvrir Fetivi',
  signature: 'Fetivi',
};
