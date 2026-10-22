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
  },
  checkoutTimeLine: 'Kérjük, {{checkoutTime}}-ig hagyd el a szállást.',
  reviewLine:
    'Ha szeretnéd elmondani, milyen volt a tartózkodásod, írhatsz értékelést itt: {{platform}}.',
  openApp: 'Fetivi megnyitása',
  signature: 'Fetivi',
};
