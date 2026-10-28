import type { HostCopy } from './types';

const rules = new Intl.PluralRules('hr');

/** Croatian has three count forms: 1, 21 → one; 2–4, 22 → few; 5–20, 25 → other. */
export function pluralHr<T>(n: number, one: T, few: T, other: T): T {
  const rule = rules.select(n);
  return rule === 'one' ? one : rule === 'few' ? few : other;
}

export const hr: HostCopy = {
  dateTimeFormat: 'd.M.yyyy. HH:mm',
  numberLocale: 'hr-HR',
  account: {
    verify: {
      subject: 'Potvrdite svoju e-adresu za Fetivi',
      text: 'Otvorite ovu poveznicu da potvrdite svoju e-adresu. Poveznica vrijedi 24 sata.',
    },
    reset: {
      subject: 'Nova lozinka za Fetivi',
      text: 'Otvorite ovu poveznicu da odaberete novu lozinku. Poveznica vrijedi 1 sat.',
    },
    alreadyRegistered: {
      subject: 'Već imate Fetivi račun',
      text: 'Netko se pokušao registrirati s ovom e-adresom, ali vi već imate Fetivi račun. Ako ste zaboravili lozinku, ovdje možete odabrati novu. Poveznica vrijedi 1 sat.',
    },
  },
  message: {
    titleUrgent: 'Hitna poruka gosta',
    titleNormal: 'Nova poruka gosta',
    subject: (title, unit) => `${title}: ${unit}`,
    intro: (property, unit, dates) =>
      `Gost koji boravi u objektu ${property}, ${unit} (${dates}) poslao vam je poruku.`,
    reason: (label) => `Razlog: ${label}`,
    urgentLine: 'Fetivi ju je označio kao hitnu.',
    readAndReply: (url) => `Pročitajte i odgovorite u svojim porukama: ${url}`,
    noReply: 'Odgovori na ovu e-poruku ne stižu do gosta.',
  },
  digest: {
    count: (n) =>
      pluralHr(n, `${n} nova poruka gosta`, `${n} nove poruke gosta`, `${n} novih poruka gosta`),
    waiting: (n) =>
      n === 1
        ? 'Čeka vas poruka gosta:'
        : pluralHr(
            n,
            `Čeka vas ${n} poruka gosta:`,
            `Čekaju vas ${n} poruke gosta:`,
            `Čeka vas ${n} poruka gosta:`,
          ),
  },
  order: {
    subjectRequest: (offer) => `Novi upit: ${offer}`,
    subjectOrder: (offer) => `Nova narudžba: ${offer}`,
    asked: (offer) => `Gost je poslao upit za „${offer}”.`,
    askedAnswerBy: (offer, at) =>
      `Gost je poslao upit za „${offer}”. Molimo odgovorite do ${at} u svojim Fetivi porukama.`,
    ordered: (offer) => `Gost je naručio „${offer}”.`,
    date: 'Datum',
    time: 'Vrijeme',
    price: 'Cijena',
    guest: 'Gost',
    guestPhone: 'Telefon gosta',
    quantity: {
      person: 'Broj osoba',
      group: 'Broj osoba',
      item: 'Količina',
      litre: 'Količina (l)',
      kilogram: 'Količina (kg)',
      hour: 'Broj sati',
      day: 'Broj dana',
    },
    respond: (url) => `Prihvatite, odbijte ili predložite drugo vrijeme: ${url}`,
    acknowledge: (url) => `Otvorite poruke i potvrdite da ste je primili: ${url}`,
    see: (url) => `Pogledajte je u porukama: ${url}`,
    noCommission: 'Fetivi ne uzima proviziju na vaše vlastite usluge.',
  },
  stayDates: {
    subject: (unit, range) => `Promijenjeni datumi boravka: ${unit}, ${range}`,
    moved: (property, unit) => `Kalendar je pomaknuo boravak u objektu ${property}, ${unit}.`,
    newDates: 'Novi datumi',
    pinSame: 'PIN ostaje isti. Ako ga gost već ima, ne trebate ga ponovno slati.',
    open: (url) => `Otvorite boravak: ${url}`,
  },
  reasons: {
    property_question: 'Pitanje o jedinici',
    problem: 'Problem',
    request: 'Zahtjev',
    guest_asked: 'Moli da ga kontaktirate',
  },
};
