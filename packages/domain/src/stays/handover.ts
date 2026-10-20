// The copy-ready messages a host sends a guest with the unit link and the PIN. Imports nothing at
// runtime: the back-office SPA bundles this file through the `@fetivi/domain/handover` subpath.
// The PIN never goes into the link: the link is inserted verbatim and nothing is appended to it.
import type { GuestLanguage } from '../property/vocabulary';

export interface HandOverInput {
  language: GuestLanguage;
  unitName: string;
  /** 'YYYY-MM-DD'. */
  checkIn: string;
  checkout: string;
  pin: string;
  /** The unit's permanent link. Never contains the PIN. */
  unitLink: string;
}

export interface HandOverMessages {
  withLink: string;
  /** For OTA message filters that block links. */
  withoutLink: string;
}

interface Template {
  intro: (unitName: string, from: string, to: string) => string;
  link: (link: string, pin: string) => string;
  noLink: (pin: string) => string;
  optional: string;
}

// hr, de, it, pl, hu, fr are machine-drafted; review with a native speaker before the pilot.
const TEMPLATES: Record<GuestLanguage, Template> = {
  en: {
    intro: (u, f, t) =>
      `Hello! For your stay at ${u} (${f} – ${t}) you can use Fetivi, a small guest app with the apartment's information and tips for the area. You can ask it questions in your own language.`,
    link: (l, p) => `Open: ${l}\nYour PIN: ${p}`,
    noLink: (p) =>
      `When you arrive, scan the QR code in the apartment and enter your PIN: ${p}\nIf you'd like to use it before you arrive, just ask me for the link.`,
    optional: 'Using Fetivi is optional. You can always message me here as usual.',
  },
  hr: {
    intro: (u, f, t) =>
      `Pozdrav! Za vaš boravak u smještaju ${u} (${f} – ${t}) možete koristiti Fetivi, malu aplikaciju za goste s informacijama o apartmanu i preporukama za okolicu. Možete joj postavljati pitanja na svom jeziku.`,
    link: (l, p) => `Otvorite: ${l}\nVaš PIN: ${p}`,
    noLink: (p) =>
      `Kad stignete, skenirajte QR kod u apartmanu i unesite svoj PIN: ${p}\nAko je želite koristiti prije dolaska, samo me zamolite za poveznicu.`,
    optional: 'Korištenje Fetivija nije obavezno. Uvijek mi možete pisati ovdje kao i obično.',
  },
  de: {
    intro: (u, f, t) =>
      `Hallo! Für Ihren Aufenthalt in ${u} (${f} – ${t}) können Sie Fetivi nutzen, eine kleine Gäste-App mit Informationen zur Wohnung und Tipps für die Umgebung. Sie können ihr Fragen in Ihrer eigenen Sprache stellen.`,
    link: (l, p) => `Öffnen: ${l}\nIhre PIN: ${p}`,
    noLink: (p) =>
      `Scannen Sie bei Ihrer Ankunft den QR-Code in der Wohnung und geben Sie Ihre PIN ein: ${p}\nWenn Sie Fetivi schon vor der Ankunft nutzen möchten, fragen Sie mich einfach nach dem Link.`,
    optional:
      'Die Nutzung von Fetivi ist freiwillig. Sie können mir hier jederzeit wie gewohnt schreiben.',
  },
  it: {
    intro: (u, f, t) =>
      `Buongiorno! Per il vostro soggiorno presso ${u} (${f} – ${t}) potete usare Fetivi, una piccola app per gli ospiti con le informazioni sull'appartamento e consigli sulla zona. Potete farle domande nella vostra lingua.`,
    link: (l, p) => `Apri: ${l}\nIl vostro PIN: ${p}`,
    noLink: (p) =>
      `Al vostro arrivo, scansionate il codice QR nell'appartamento e inserite il vostro PIN: ${p}\nSe volete usarla prima dell'arrivo, chiedetemi pure il link.`,
    optional: "L'uso di Fetivi è facoltativo. Potete sempre scrivermi qui come al solito.",
  },
  pl: {
    intro: (u, f, t) =>
      `Dzień dobry! Podczas pobytu w obiekcie ${u} (${f} – ${t}) mogą Państwo korzystać z Fetivi, małej aplikacji dla gości z informacjami o apartamencie i poradami dotyczącymi okolicy. Można jej zadawać pytania we własnym języku.`,
    link: (l, p) => `Otwórz: ${l}\nPaństwa PIN: ${p}`,
    noLink: (p) =>
      `Po przyjeździe proszę zeskanować kod QR w apartamencie i wpisać PIN: ${p}\nJeśli chcą Państwo skorzystać z niej przed przyjazdem, proszę poprosić mnie o link.`,
    optional:
      'Korzystanie z Fetivi jest dobrowolne. Zawsze mogą Państwo napisać do mnie tutaj, jak zwykle.',
  },
  hu: {
    intro: (u, f, t) =>
      `Üdvözlöm! A szálláson (${u}, ${f} – ${t}) töltött tartózkodása idejére használhatja a Fetivit, egy kis vendégalkalmazást a szállás adataival és környékbeli tippekkel. A saját nyelvén is feltehet neki kérdéseket.`,
    link: (l, p) => `Megnyitás: ${l}\nAz Ön PIN-kódja: ${p}`,
    noLink: (p) =>
      `Érkezéskor olvassa be a szálláson található QR-kódot, és adja meg a PIN-kódját: ${p}\nHa már érkezés előtt használná, kérje el tőlem a linket.`,
    optional:
      'A Fetivi használata nem kötelező. Továbbra is bármikor írhat nekem itt, ahogy eddig.',
  },
  fr: {
    intro: (u, f, t) =>
      `Bonjour ! Pour votre séjour à ${u} (${f} – ${t}), vous pouvez utiliser Fetivi, une petite application pour les voyageurs avec les informations sur le logement et des conseils sur le quartier. Vous pouvez lui poser des questions dans votre langue.`,
    link: (l, p) => `Ouvrir : ${l}\nVotre code PIN : ${p}`,
    noLink: (p) =>
      `À votre arrivée, scannez le QR code dans le logement et saisissez votre code PIN : ${p}\nSi vous souhaitez l'utiliser avant votre arrivée, demandez-moi simplement le lien.`,
    optional:
      "L'utilisation de Fetivi est facultative. Vous pouvez toujours m'écrire ici comme d'habitude.",
  },
};

/** The "Fetivi is optional" sentence per language. */
export const OPTIONAL_LINE = Object.fromEntries(
  Object.entries(TEMPLATES).map(([language, t]) => [language, t.optional]),
) as Record<GuestLanguage, string>;

/** A civil date formatted in UTC so it never shifts a day. */
function civilDate(date: string, language: GuestLanguage): string {
  return new Intl.DateTimeFormat(language, {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

export function handOverMessages(input: HandOverInput): HandOverMessages {
  const t = TEMPLATES[input.language];
  const intro = t.intro(
    input.unitName,
    civilDate(input.checkIn, input.language),
    civilDate(input.checkout, input.language),
  );
  return {
    withLink: `${intro}\n\n${t.link(input.unitLink, input.pin)}\n\n${t.optional}`,
    withoutLink: `${intro}\n\n${t.noLink(input.pin)}\n\n${t.optional}`,
  };
}
