// Machine-drafted, unreviewed. Check with a native speaker before the pilot.
import type { GuestCopy } from './types';

export const hr: GuestCopy = {
  dateFormat: 'EEE, d. M.',
  dateAtTime: '{{date}} u {{time}}',
  kinds: {
    order_confirmed: {
      subject: 'Potvrđeno: {{offer}}, {{date}}',
      lines: [
        'Dobre vijesti: {{offer}} ({{date}}) je potvrđeno.',
        'Pojedinosti su u odjeljku Moje putovanje.',
      ],
      pushTitle: 'Potvrđeno',
      pushBody: '{{offer}}, {{date}}',
    },
    order_new_proposal: {
      subject: 'Novo vrijeme ili cijena za {{offer}}',
      lines: [
        'Pružatelj usluge {{offer}} predložio je drugo vrijeme ili cijenu.',
        'Otvorite Moje putovanje da prihvatite ili odbijete prijedlog.',
      ],
      pushTitle: 'Novi prijedlog',
      pushBody: '{{offer}}: pogledajte prijedlog',
    },
    order_cancelled: {
      subject: 'Otkazano: {{offer}}, {{date}}',
      lines: ['{{offer}} ({{date}}) je otkazano.', 'Pojedinosti su u odjeljku Moje putovanje.'],
      pushTitle: 'Otkazano',
      pushBody: '{{offer}}, {{date}}',
    },
    order_declined: {
      subject: 'Nije dostupno: {{offer}}, {{date}}',
      lines: [
        'Nažalost, pružatelj ne može prihvatiti vašu rezervaciju za {{offer}} ({{date}}).',
        'U razgovoru me možete pitati za nešto drugo.',
      ],
      pushTitle: 'Nije dostupno',
      pushBody: '{{offer}}, {{date}}',
    },
    order_expired: {
      subject: 'Nema odgovora na vrijeme: {{offer}}, {{date}}',
      lines: [
        'Pružatelj nije odgovorio na vrijeme pa je vaš zahtjev za {{offer}} ({{date}}) zatvoren.',
        'U razgovoru me možete pitati za nešto drugo.',
      ],
      pushTitle: 'Zahtjev je zatvoren',
      pushBody: '{{offer}}, {{date}}',
    },
    order_failed: {
      subject: 'Rezervacija nije uspjela: {{offer}}, {{date}}',
      lines: [
        'Nešto je pošlo po zlu i {{offer}} ({{date}}) nije rezervirano.',
        'Možete pokušati ponovno ili me pitati u razgovoru.',
      ],
      pushTitle: 'Rezervacija nije uspjela',
      pushBody: '{{offer}}, {{date}}',
    },
    order_reminder: {
      subject: 'Sutra: {{offer}}',
      lines: [
        'Podsjetnik: {{offer}} je sutra, {{date}}.',
        'Pojedinosti su u odjeljku Moje putovanje.',
      ],
      pushTitle: 'Sutra',
      pushBody: '{{offer}}, {{date}}',
    },
    host_reply: {
      subject: 'Domaćin vam je odgovorio',
      lines: ['Domaćin je odgovorio na vašu poruku.', 'Otvorite razgovor da je pročitate.'],
      pushTitle: 'Domaćin vam je odgovorio',
      pushBody: 'Otvorite razgovor da pročitate odgovor.',
    },
    arrival_details: {
      subject: 'Podaci za dolazak su spremni',
      lines: ['Podaci za dolazak spremni su u Vodiču: kako ući, Wi-Fi i ostalo.', 'Sretan put!'],
      pushTitle: 'Podaci za dolazak su spremni',
      pushBody: 'Otvorite Vodič da vidite kako ući.',
    },
    checkout_reminder: {
      subject: 'Odjava je sutra',
      lines: ['Podsjetnik: odjava je sutra.'],
      pushTitle: 'Odjava je sutra',
      pushBody: 'Koraci za odjavu su u Vodiču.',
    },
  },
  checkoutTimeLine: 'Molimo napustite smještaj do {{checkoutTime}}.',
  reviewLine: 'Ako želite podijeliti kako vam je bilo, recenziju možete ostaviti na {{platform}}.',
  spaceEmails: {
    verify_email: {
      subject: 'Potvrdite svoju e-adresu za Fetivi',
      lines: [
        'Molim vas potvrdite da je ovo vaša e-adresa. Tada vam mogu slati novosti o vašem boravku, poput odgovora vašeg domaćina.',
        'Poveznica vrijedi 24 sata.',
      ],
      action: 'Potvrdi e-adresu',
    },
    recover: {
      subject: 'Vaša poveznica natrag u Fetivi',
      lines: [
        'Evo vaše poveznice za otvaranje Fetivija na ovom ili drugom uređaju, s vašim razgovorom i rezervacijama.',
        'Vrijedi jednom, 1 sat. Ako je niste tražili, možete zanemariti ovu poruku.',
      ],
      action: 'Otvori moj Fetivi',
    },
  },
  openApp: 'Otvorite Fetivi',
  signature: 'Fetivi',
};
