// Machine-drafted, unreviewed. Check with a native speaker before the pilot.
import type { Messages } from './en';

// French puts a no-break space (U+00A0) before ! and ?.
export const fr: Messages = {
  picker: {
    title: 'Choisissez votre langue',
    mascot: 'Bok ! Je suis Fetivi. Dans quelle langue parlons-nous ?',
    yourLanguage: 'La langue de votre téléphone',
  },
  pin: {
    title: 'Saisissez votre PIN',
    hint: 'Votre hôte vous a envoyé un PIN à six chiffres.',
    label: 'PIN',
    submit: 'Continuer',
    wrong: 'Ce PIN ne correspond pas. Vérifiez le message de votre hôte et réessayez.',
    wait: 'Trop de tentatives. Vous pourrez réessayer dans {{time}}.',
    changeLanguage: 'Changer de langue',
  },
  link: {
    notFound: "Ce lien ne fonctionne pas. Scannez à nouveau le code QR dans l'appartement.",
    none: "Ouvrez le lien envoyé par votre hôte ou scannez le code QR dans l'appartement.",
  },
  header: {
    language: 'Langue',
    chooseLanguage: 'Choisissez une langue',
  },
  tabs: {
    label: 'Rubriques',
    chat: 'Discussion',
    guide: 'Guide',
    trip: 'Mon séjour',
    unread: 'Non lus : {{count}}',
  },
  empty: {
    chat: "C'est ici que nous discuterons. J'arrive bientôt.",
    guide: "Le guide de l'appartement et des environs apparaîtra ici.",
    trip: 'Les projets de votre séjour apparaîtront ici.',
  },
  chat: {
    title: 'Discussion',
    welcome:
      "Bok ! Je suis Fetivi, un assistant IA pour votre séjour. Posez-moi vos questions sur l'appartement, comme le Wi-Fi, l'arrivée, le règlement intérieur ou le fonctionnement des choses, et sur les environs. Si je ne sais pas quelque chose, je peux demander à votre hôte pour vous.",
    you: 'Vous',
    fetivi: 'Fetivi',
    typing: 'Fetivi écrit…',
    inputLabel: 'Message à Fetivi',
    placeholder: 'Posez-moi vos questions sur votre séjour',
    send: 'Envoyer',
    closed: 'Votre séjour est terminé. Vous pouvez toujours lire cette discussion.',
    startersLabel: 'Des idées pour commencer',
    starterWifi: 'Quel est le mot de passe du Wi-Fi ?',
    starterTimes: "À quelle heure sont l'arrivée et le départ ?",
    starterAccess: 'Comment entrer ?',
    starterRules: 'Quel est le règlement intérieur ?',
    starterAround: "Qu'y a-t-il de bien à faire dans le coin ?",
    tripTitle: 'Parlez-moi de votre voyage',
    tripBody: "Qui voyage et qu'aimez-vous ? Je m'en souviendrai. Vous pouvez passer cette étape.",
    tripStart: "C'est parti",
    tripSkip: 'Passer',
    tripMessage: "J'aimerais vous parler de notre voyage.",
    errorTurn: 'Un problème est survenu. Réessayez.',
    errorBusy: 'Je réponds encore à votre dernier message.',
    errorClosed: 'Votre séjour est terminé, la discussion est donc en lecture seule.',
    retry: 'Réessayer',
  },
  common: {
    close: 'Fermer',
    loading: 'Chargement…',
  },
  error: {
    network: 'Pas de connexion. Vérifiez votre connexion internet et réessayez.',
  },
};
