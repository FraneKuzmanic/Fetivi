import type { Translation } from '../../types';
import type { auth as en } from '../en/auth';

export const auth: Translation<typeof en> = {
  pitch: 'Vaš objekt, objašnjen svakom gostu',
  pitchBody:
    'Upišite podatke jednom: Wi-Fi, prijavu, kućni red, mjesta koja volite. Fetivi iz njih odgovara na pitanja vaših gostiju, na njihovu jeziku, i javi vam kad netko treba vas.',
  email: 'E-adresa',
  password: 'Lozinka',
  newPassword: 'Nova lozinka',
  showPassword: 'Prikaži lozinku',
  passwordHint: 'Najmanje 10 znakova.',
  sending: 'Šaljemo…',
  backToLogin: 'Natrag na prijavu',
  logIn: 'Prijava',
  checkEmail: 'Provjerite e-poštu',
  spam: 'Nema je ni nakon minute? Pogledajte mapu neželjene pošte.',
  otherEmail: 'Upotrijebi drugu e-adresu',
  login: {
    loggingIn: 'Prijava…',
    forgot: 'Zaboravili ste lozinku?',
    resend: 'Pošalji novu poveznicu za potvrdu',
    newHost: 'Novi ste domaćin? <anchor>Otvorite račun</anchor>',
  },
  signUp: {
    title: 'Otvorite račun domaćina',
    submit: 'Otvori račun',
    creating: 'Otvaramo račun…',
    haveAccount: 'Već imate račun? <anchor>Prijavite se</anchor>',
    sent: 'Poslali smo poveznicu za potvrdu na <strong>{{email}}</strong>. Vrijedi 24 sata.',
    sendAgain: 'Pošalji ponovno',
    nextTitle: 'Što slijedi',
    next1: 'Otvorite poveznicu da potvrdite e-adresu, zatim se prijavite.',
    next2: 'Dodajte svoj objekt i njegove jedinice.',
    next3: 'Fetivi provjerava i odobrava objekt.',
    next4: 'Ispunite Vodič. Kad upišete osnovno, jedinica je objavljena.',
  },
  forgot: {
    title: 'Nova lozinka',
    submit: 'Pošalji poveznicu',
    sent: 'Ako postoji račun za <strong>{{email}}</strong>, poslali smo poveznicu za novu lozinku. Vrijedi 1 sat.',
  },
  reset: {
    title: 'Odaberite novu lozinku',
    done: 'Lozinka je promijenjena',
    submit: 'Spremi novu lozinku',
    saving: 'Spremanje…',
    invalid: 'Ova poveznica nije valjana ili je istekla. <anchor>Zatražite novu</anchor>',
  },
  verify: {
    title: 'Potvrdite e-adresu',
    done: 'E-adresa je potvrđena',
    checking: 'Provjeravamo poveznicu…',
    invalid: 'Ova poveznica nije valjana ili je istekla.',
    resent: 'Ako <strong>{{email}}</strong> još treba potvrdu, poslali smo novu poveznicu.',
    submit: 'Pošalji novu poveznicu',
  },
  resent: 'Poslali smo novu poveznicu na {{email}}.',
};
