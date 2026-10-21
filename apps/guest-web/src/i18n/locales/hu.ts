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
  chat: {
    title: 'Csevegés',
    welcome:
      'Bok! Fetivi vagyok, egy AI-asszisztens az ott-tartózkodásodhoz. Kérdezz az apartmanról, például a Wi-Firől, a bejelentkezésről, a házirendről vagy arról, hogyan működnek a dolgok, és a környékről. Ha valamit nem tudok, megkérdezhetem helyetted a szállásadódat.',
    you: 'Te',
    fetivi: 'Fetivi',
    typing: 'Fetivi ír…',
    inputLabel: 'Üzenet Fetivinek',
    placeholder: 'Kérdezz bármit az ott-tartózkodásodról',
    send: 'Küldés',
    closed: 'Az ott-tartózkodásod véget ért. Ezt a csevegést továbbra is elolvashatod.',
    startersLabel: 'Ötletek a kezdéshez',
    starterWifi: 'Mi a Wi-Fi jelszava?',
    starterTimes: 'Mikor van a bejelentkezés és a kijelentkezés?',
    starterAccess: 'Hogyan jutok be?',
    starterRules: 'Mi a házirend?',
    starterAround: 'Mit érdemes csinálni a környéken?',
    tripTitle: 'Mesélj az utazásodról',
    tripBody: 'Kik utaznak, és mit szerettek? Megjegyzem. Ezt át is ugorhatod.',
    tripStart: 'Kezdjük',
    tripSkip: 'Kihagyás',
    tripMessage: 'Elmesélem az utazásunkat.',
    errorTurn: 'Valami hiba történt. Próbáld újra.',
    errorBusy: 'Még válaszolok az előző üzenetedre.',
    errorClosed: 'Az ott-tartózkodásod véget ért, így a csevegés most már csak olvasható.',
    retry: 'Újrapróbálás',
  },
  common: {
    close: 'Bezárás',
    loading: 'Betöltés…',
  },
  error: {
    network: 'Nincs kapcsolat. Ellenőrizd az internetet, és próbáld újra.',
  },
};
