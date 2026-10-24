import type { GuestLanguage } from '../../property/vocabulary';
import { WIZARD_COPY } from '../../property/wizard-copy';
import { type GapTopic, gapTarget } from './vocabulary';

interface SentenceArgs {
  label: string;
  step: string;
  stays: number;
}

/**
 * Fetivi's Suggestion sentence in each back-office language (44 AC 2). It takes only the wizard
 * label, the step title and the Stay count, never anything a guest wrote. Labels are quoted, so
 * no language needs to inflect them. The count is always 2 or more.
 */
const SENTENCES: Record<GuestLanguage, (a: SentenceArgs) => string> = {
  en: (a) =>
    `Guests in ${a.stays} stays asked about “${a.label}”, and Fetivi had no answer. Add it under “${a.step}” so Fetivi can answer next time.`,
  hr: (a) => {
    const rule = new Intl.PluralRules('hr').select(a.stays);
    const form = rule === 'one' ? 'boravku' : rule === 'few' ? 'boravka' : 'boravaka';
    return `U ${a.stays} ${form} gosti su pitali za „${a.label}”, a Fetivi nije imao odgovor. Dodajte to u koraku „${a.step}” da Fetivi idući put može odgovoriti.`;
  },
  de: (a) =>
    `Gäste in ${a.stays} Aufenthalten haben nach „${a.label}“ gefragt, und Fetivi hatte keine Antwort. Ergänzen Sie es unter „${a.step}“, damit Fetivi beim nächsten Mal antworten kann.`,
  it: (a) =>
    `Gli ospiti di ${a.stays} soggiorni hanno chiesto di «${a.label}» e Fetivi non aveva una risposta. Aggiungilo in «${a.step}» così Fetivi potrà rispondere la prossima volta.`,
  pl: (a) =>
    `Goście w ${a.stays} pobytach pytali o „${a.label}”, a Fetivi nie znał odpowiedzi. Dodaj to w kroku „${a.step}”, żeby Fetivi mógł odpowiedzieć następnym razem.`,
  hu: (a) =>
    `${a.stays} tartózkodás vendégei kérdeztek erről: „${a.label}”, és a Fetivinek nem volt válasza. Adja meg itt: „${a.step}”, hogy a Fetivi legközelebb válaszolni tudjon.`,
  fr: (a) =>
    `Des voyageurs de ${a.stays} séjours ont posé une question sur « ${a.label} », et Fetivi n’avait pas de réponse. Ajoutez-la dans « ${a.step} » pour que Fetivi puisse répondre la prochaine fois.`,
};

/** The Suggestion's text, written by Fetivi in the host's language from fixed templates. */
export function suggestionText(lang: GuestLanguage, topic: GapTopic, stays: number): string {
  const copy = WIZARD_COPY[lang];
  return SENTENCES[lang]({
    label: copy.fields[topic].label,
    step: copy.steps[gapTarget(topic).stepId].title,
    stays,
  });
}
