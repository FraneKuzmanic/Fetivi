// Machine-drafted, unreviewed. Check with a native speaker before the pilot.
import type { GuestCopy } from './types';

export const hu: GuestCopy = {
  dateFormat: 'MMM d., EEE',
  dateAtTime: '{{date}} {{time}}',
  kinds: {
    order_confirmed: {
      subject: 'Visszaigazolva: {{offer}}, {{date}}',
      lines: [
        'Jó hír: {{offer}} ({{date}}) visszaigazolva.',
        'A részleteket az Utazásom fülön találod.',
      ],
      pushTitle: 'Visszaigazolva',
      pushBody: '{{offer}}, {{date}}',
    },
    order_new_proposal: {
      subject: 'Új időpont vagy ár: {{offer}}',
      lines: [
        '{{offer}} szolgáltatója más időpontot vagy árat javasolt.',
        'Nyisd meg az Utazásom fület, és fogadd el vagy utasítsd el.',
      ],
      pushTitle: 'Új javaslat',
      pushBody: '{{offer}}: nézd meg',
    },
    order_cancelled: {
      subject: 'Lemondva: {{offer}}, {{date}}',
      lines: ['{{offer}} ({{date}}) lemondva.', 'A részleteket az Utazásom fülön találod.'],
      pushTitle: 'Lemondva',
      pushBody: '{{offer}}, {{date}}',
    },
    order_declined: {
      subject: 'Nem elérhető: {{offer}}, {{date}}',
      lines: [
        'Sajnos a szolgáltató nem tudja elfogadni a foglalásodat: {{offer}} ({{date}}).',
        'A csevegésben kérdezhetsz tőlem mást.',
      ],
      pushTitle: 'Nem elérhető',
      pushBody: '{{offer}}, {{date}}',
    },
    order_expired: {
      subject: 'Nem jött válasz időben: {{offer}}, {{date}}',
      lines: [
        'A szolgáltató nem válaszolt időben, ezért a kérésed lezárult: {{offer}} ({{date}}).',
        'A csevegésben kérdezhetsz tőlem mást.',
      ],
      pushTitle: 'A kérés lezárult',
      pushBody: '{{offer}}, {{date}}',
    },
    order_checkout_expired: {
      subject: 'Nem fejeződött be időben: {{offer}}, {{date}}',
      lines: [
        'A fizetés nem fejeződött be időben, ezért a foglalás lezárult, és nem terheltünk semmit: {{offer}} ({{date}}).',
        'A csevegésben megkérhetsz, hogy próbáljuk újra.',
      ],
      pushTitle: 'A foglalás lezárult',
      pushBody: '{{offer}}, {{date}}',
    },
    order_failed: {
      subject: 'A foglalás nem sikerült: {{offer}}, {{date}}',
      lines: [
        'Valami hiba történt, és nem sikerült lefoglalni: {{offer}} ({{date}}).',
        'Próbáld újra, vagy kérdezz a csevegésben.',
      ],
      pushTitle: 'A foglalás nem sikerült',
      pushBody: '{{offer}}, {{date}}',
    },
    order_reminder: {
      subject: 'Holnap: {{offer}}',
      lines: [
        'Emlékeztető: {{offer}} holnap lesz, {{date}}.',
        'A részleteket az Utazásom fülön találod.',
      ],
      pushTitle: 'Holnap',
      pushBody: '{{offer}}, {{date}}',
    },
    host_reply: {
      subject: 'Válaszolt a szállásadód',
      lines: ['A szállásadód válaszolt az üzenetedre.', 'Nyisd meg a csevegést, hogy elolvasd.'],
      pushTitle: 'Válaszolt a szállásadód',
      pushBody: 'Nyisd meg a csevegést, hogy elolvasd a választ.',
    },
    arrival_details: {
      subject: 'Készen állnak az érkezési információk',
      lines: [
        'Az érkezési információk az Útmutatóban várnak: hogyan jutsz be, a Wi-Fi és a többi.',
        'Jó utat!',
      ],
      pushTitle: 'Készen állnak az érkezési információk',
      pushBody: 'Nyisd meg az Útmutatót, és nézd meg, hogyan jutsz be.',
    },
    checkout_reminder: {
      subject: 'Holnap van a kijelentkezés',
      lines: ['Emlékeztető: holnap van a kijelentkezés.'],
      pushTitle: 'Holnap van a kijelentkezés',
      pushBody: 'A kijelentkezés lépései az Útmutatóban vannak.',
    },
    weather_warning: {
      subject: 'A DHMZ időjárási figyelmeztetése ({{level}})',
      lines: [
        'A DHMZ, a horvát meteorológiai szolgálat időjárási figyelmeztetést ({{level}}) adott ki erre a területre: {{area}}, {{time}}:',
        '„{{event}}. {{description}}”',
      ],
      pushTitle: 'DHMZ időjárási figyelmeztetés ({{level}})',
      pushBody: '{{event}}, {{time}}',
    },
    ferry_disruption: {
      subject: 'A Jadrolinija közleménye a(z) {{lines}} vonalról',
      lines: [
        'A Jadrolinija közleménye szerint: „{{bulletinTitle}}”',
        'Ez érintheti ezt: {{offer}}, {{date}} ({{lines}} vonal). Indulás előtt olvasd el a közleményt: {{bulletinUrl}}',
      ],
      pushTitle: 'Jadrolinija közlemény: {{lines}} vonal',
      pushBody: '{{offer}}, {{date}}',
    },
    daily_tip: {
      subject: 'Tipp holnapra: {{offer}}',
      // The rule's own lines (tipRules) are used instead.
      lines: [],
      pushTitle: 'Tipp holnapra',
      pushBody: '{{offer}}',
    },
  },
  warningLevels: { yellow: 'sárga', orange: 'narancs', red: 'piros' },
  warningTime: '{{from}} – {{to}}',
  sailingAdvisory:
    'A tengeri viszonyok megzavarhatják a járatokat a(z) {{lines}} vonalon ({{offer}}, {{date}}). Indulás előtt érdeklődj itt: {{operator}}, {{operatorUrl}}',
  orderStands:
    'A foglalásod érvényes marad, hacsak a szolgáltató le nem mondja. Ha mégis, azonnal szólok.',
  freeCancellationEnded:
    'A kérésedet az ingyenes lemondási határidő után fogadták el, így a lemondás már nem ingyenes.',
  sourceLine: 'Forrás: {{source}}, {{sourceUrl}}',
  checkoutTimeLine: 'Kérjük, {{checkoutTime}}-ig hagyd el a szállást.',
  reviewLine:
    'Ha szeretnéd elmondani, milyen volt a tartózkodásod, írhatsz értékelést itt: {{platform}}.',
  tipRules: {
    rain: ['Holnap, {{date}}, esőre van kilátás.', 'Ilyenkor jó választás: {{offer}}{{distance}}.'],
    event: ['Mivel szereted az ilyesmit: {{offer}} holnap, {{date}}{{venue}}.'],
    gap: [
      'Holnap, {{date}}, még üres a terved.',
      'Mit szólnál ehhez: {{offer}}{{distance}}? Kérdezz, és elmondok többet.',
    ],
  },
  tipDistance: ' ({{km}} km-re)',
  tipVenue: ', helyszín: {{venueName}}',
  tipUnsubscribe: 'Naponta egy tippet kapsz, mert ezt kérted. Egy kattintással leiratkozhatsz:',
  spaceEmails: {
    verify_email: {
      subject: 'Erősítsd meg az e-mail-címed a Fetivihez',
      lines: [
        'Kérlek, erősítsd meg, hogy ez a te e-mail-címed. Így küldhetek neked híreket a szállásodról, például a szállásadód válaszait.',
        'A link 24 óráig érvényes.',
      ],
      action: 'E-mail-cím megerősítése',
    },
    recover: {
      subject: 'A linked vissza a Fetivihez',
      lines: [
        'Ezzel a linkkel megnyithatod a Fetividet ezen vagy egy másik eszközön, a csevegéssel és a foglalásaiddal együtt.',
        'Egyszer használható, 1 óráig. Ha nem te kérted, nyugodtan hagyd figyelmen kívül ezt az e-mailt.',
      ],
      action: 'Fetivim megnyitása',
    },
  },
  openApp: 'Fetivi megnyitása',
  signature: 'Fetivi',
};
