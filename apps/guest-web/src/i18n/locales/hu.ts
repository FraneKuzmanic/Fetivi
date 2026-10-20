// Machine-drafted, unreviewed. Check with a native speaker before the pilot.
import type { Messages } from './en';

export const hu: Messages = {
  picker: {
    title: 'Válassz nyelvet',
    mascot: 'Bok! Fetivi vagyok. Milyen nyelven beszélgessünk?',
    yourLanguage: 'A telefonod nyelve',
  },
  pin: {
    title: 'Add meg a PIN-kódot',
    hint: 'A szállásadód küldött egy hatjegyű PIN-kódot.',
    label: 'PIN-kód',
    submit: 'Tovább',
    wrong: 'Ez a PIN-kód nem egyezik. Nézd meg a szállásadód üzenetét, és próbáld újra.',
    wait: 'Túl sok próbálkozás. {{time}} múlva próbálhatod újra.',
    changeLanguage: 'Nyelv módosítása',
  },
  link: {
    notFound: 'Ez a link nem működik. Olvasd be újra a QR-kódot az apartmanban.',
    none: 'Nyisd meg a szállásadódtól kapott linket, vagy olvasd be a QR-kódot az apartmanban.',
  },
  header: {
    language: 'Nyelv',
    chooseLanguage: 'Válassz nyelvet',
  },
  tabs: {
    label: 'Részek',
    chat: 'Csevegés',
    guide: 'Útmutató',
    trip: 'Utazásom',
    unread: '{{count}} olvasatlan',
  },
  empty: {
    chat: 'Itt fogunk beszélgetni. Hamarosan itt leszek.',
    guide: 'Itt jelenik majd meg az apartman és a környék útmutatója.',
    trip: 'Itt jelennek majd meg az utazási terveid.',
  },
  common: {
    close: 'Bezárás',
    loading: 'Betöltés…',
  },
  error: {
    network: 'Nincs kapcsolat. Ellenőrizd az internetet, és próbáld újra.',
  },
};
