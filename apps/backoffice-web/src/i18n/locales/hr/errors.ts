import type { Translation } from '../../types';
import type { errors as en } from '../en/errors';

export const errors: Translation<typeof en> = {
  internal: 'Nešto nije u redu. Pokušajte ponovno.',
  'invalid-input': 'Provjerite što ste upisali.',
  'invalid-credentials': 'E-adresa ili lozinka nisu točni.',
  'email-not-verified':
    'Najprije potvrdite svoju e-adresu. Poveznicu ćete naći u pristigloj pošti.',
  'account-suspended': 'Ovaj je račun suspendiran. Javite se Fetiviju.',
  'too-many-attempts': 'Previše pokušaja. Pričekajte 15 minuta pa pokušajte ponovno.',
  'invalid-token': 'Ova poveznica nije valjana ili je istekla.',
  unauthenticated: 'Prijavite se ponovno.',
  forbidden: 'Nemate pristup ovome.',
  'stop-acting-first': 'Najprije prestanite raditi kao domaćin.',
  'bad-origin': 'Ovaj je zahtjev blokiran. Ponovno učitajte stranicu.',
  'not-found': 'Nije pronađeno.',
  'already-replied': 'Na ovu ste poruku već odgovorili.',
  'not-approved': 'Fetivi mora odobriti objekt prije nego što jedinica može biti objavljena.',
  'not-ready':
    'Ova jedinica još ne zadovoljava minimum za objavu. Otvorite postavljanje i pogledajte što nedostaje.',
  'stale-revision': 'Tekst se promijenio dok ste ga uređivali. Ponovno učitajte i pokušajte opet.',
  'translation-not-failed': 'Ovaj prijevod nije u stanju neuspjeha.',
  'destination-not-empty': 'Najprije obrišite zapise ove destinacije.',
  'provider-has-offers': 'Najprije obrišite ponude ovog pružatelja usluge.',
  'offer-has-slots': 'Najprije obrišite termine.',
  'seats-taken': 'Neka su mjesta već zauzeta.',
  'offer-has-orders': 'Ova usluga ima narudžbe. Umjesto brisanja je isključite.',
  'unit-not-live':
    'Boravke možete upisivati kad je jedinica objavljena: kad je Fetivi odobri i kad je minimum postavljanja ispunjen.',
  'stay-ended': 'Ovaj je boravak završio i više se ne može mijenjati.',
  'unsupported-media':
    'Koristite fotografiju u formatu JPEG, PNG ili WebP, ili videozapis MP4 ili WebM.',
  'media-too-large': 'Datoteka je prevelika: fotografije do 10 MB, videozapisi do 50 MB.',
  'too-many-media':
    'Unos može imati najviše 6 fotografija ili videozapisa. Najprije uklonite jedan.',
  'unsupported-manual': 'Učitajte PDF, Word (.docx) ili tekstnu datoteku, ili zalijepite tekst.',
  'manual-too-large': 'Datoteka je prevelika: upute do 10 MB.',
  'manual-too-long':
    'Upute su preduge: najviše 60.000 znakova. Zalijepite dijelove koji trebaju gostima.',
  'manual-empty':
    'U ovoj datoteci nismo pronašli tekst. Ako je to skenirani PDF, zalijepite tekst.',
  'import-failed': 'Čitanje uputa nije uspjelo. Pokušajte ponovno za minutu.',
  'import-not-configured': 'Uvoz uputa trenutačno nije dostupan. Javite se Fetiviju.',
  'draft-resolved': 'Ovaj je nacrt već obrađen. Ponovno učitajte stranicu.',
  'invalid-calendar-url':
    'Ovo nije poveznica kalendara s Airbnba ili Booking.coma. Zalijepite poveznicu za izvoz iz postavki njihova kalendara.',
  'calendar-exists': 'Ovaj je kalendar već dodan.',
  'too-many-calendars': 'Jedinica može imati najviše 6 kalendara.',
  'proposal-gone': 'Ova je rezervacija već obrađena. Ponovno učitajte stranicu.',
  'not-possibly-cancelled': 'Ovaj boravak nije označen kao moguće otkazan.',
  'no-account':
    'Najprije izradite poveznicu za uključivanje: ovaj pružatelj usluge još nema Stripe račun.',
  'open-card-orders':
    'Narudžba plaćena karticom još je otvorena. Završite je ili otkažite pa zatim odspojite.',
  'payments-not-configured':
    'Online plaćanje nije postavljeno na ovom poslužitelju (nema Stripe ključa).',
  'stripe-unavailable': 'Stripe nije odgovorio. Pokušajte ponovno za minutu.',
  'stripe-rejected':
    'Stripe je odbio zahtjev. Provjerite podatke pružatelja usluge i pokušajte ponovno.',
  'not-cancellable':
    'Ova se narudžba više ne može otkazati. Ponovno učitajte stranicu da vidite njezin status.',
  'not-refundable':
    'Za ovu narudžbu povrat ovdje nije moguć: povrat je već napravljen ili ništa nije naplaćeno. Daljnji povrati rade se na Stripe nadzornoj ploči pružatelja usluge.',
  'not-answerable':
    'Ova narudžba više ne čeka pružatelja usluge ili su joj se uvjeti promijenili. Ponovno učitajte stranicu.',
  'not-reviewable': 'Netko je već pregledao ovu stavku.',
  'invalid-state': 'Ovo se u međuvremenu promijenilo. Popis sada prikazuje stvarno stanje.',
  'import-running': 'Za ovu destinaciju uvoz je već u tijeku.',
  'run-running': 'Za ovu destinaciju osvježavanje je već u tijeku.',
  'already-picked': 'Već je među vašim preporukama.',
  'limit-reached': 'Možete podijeliti najviše {{limit}} mjesta.',
  'outside-destination':
    'To je mjesto izvan destinacije vašeg objekta. Odaberite mjesto u istom području kao vaš objekt.',
  'no-destination': 'Vaš objekt još nije unutar neke Fetivi destinacije.',
};
