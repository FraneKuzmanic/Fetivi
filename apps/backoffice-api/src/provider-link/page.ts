import {
  formatCivilDate,
  type ProviderLanguage,
  type ProviderLinkAction,
  type ProviderLinkView,
} from '@fetivi/domain';

// The Provider's order page: server-rendered, no JavaScript, no external requests, one column
// that fits a phone. Colours are the back-office palette (apps/backoffice-web/src/styles.css).

/** What the page says after an action's redirect. */
export const FLASHES = [
  'acknowledged',
  'cancelled',
  'accepted',
  'declined',
  'proposed',
  'unchanged',
  'stale',
  'rejected',
] as const;
export type Flash = (typeof FLASHES)[number];

/** The new-terms form as typed, so a refused post shows it again. */
export interface TermsForm {
  date: string;
  time: string;
  price: string;
}

/** The field a refused new-terms post got wrong; `terms` is the machine's refusal. */
export type FormError = 'date' | 'time' | 'price' | 'terms';

const STRINGS = {
  hr: {
    title: 'Narudžba',
    other: { lang: 'en', label: 'English' },
    offer: 'Ponuda',
    date: 'Datum',
    time: 'Vrijeme',
    /** The quantity's label per price unit; the value is the bare number. */
    quantity: { person: 'Broj osoba', group: 'Broj grupa', item: 'Količina' },
    guestName: 'Gost',
    guestPhone: 'Telefon gosta',
    price: 'Cijena',
    status: {
      waiting: (at: string) => `Čeka vaš odgovor do ${at}`,
      guest: 'Čeka gosta',
      declined: 'Odbijena',
      confirmed: 'Potvrđena',
      acknowledged: 'Primitak potvrđen',
      cancelled: 'Otkazana',
      closed: 'Zatvorena',
      open: 'U obradi',
    },
    acknowledge: 'Primljeno',
    cannotFulfil: 'Ne mogu izvršiti',
    accept: 'Prihvati',
    acceptWithPrice: 'Prihvati uz cijenu',
    suggestTime: 'Predloži drugo vrijeme',
    decline: 'Odbij',
    suggestTitle: 'Predložite drugo vrijeme',
    suggestText: 'Gost će dobiti vaš prijedlog i moći ga prihvatiti ili odbiti.',
    priceTitle: 'Prihvatite uz cijenu',
    priceText: 'Upišite ukupnu cijenu narudžbe. Gost će je moći prihvatiti ili odbiti.',
    newDate: 'Datum',
    newTime: 'Vrijeme (neobavezno)',
    totalPrice: 'Ukupna cijena',
    send: 'Pošalji gostu',
    formError: {
      date: (from: string, to: string) => `Odaberite datum od ${from} do ${to}.`,
      time: 'Upišite vrijeme kao SS:MM.',
      price: 'Upišite cijenu veću od nule, npr. 120 ili 120,50.',
      terms: 'Ovaj prijedlog nije moguć. Provjerite je li vrijeme u budućnosti.',
    },
    confirmTitle: 'Ne možete izvršiti narudžbu?',
    confirmText: 'Narudžba će biti otkazana, a Fetivi će obavijestiti gosta.',
    confirmYes: 'Da, otkaži narudžbu',
    back: 'Natrag',
    flash: {
      acknowledged: 'Hvala, primitak je zabilježen.',
      cancelled: 'Narudžba je otkazana. Fetivi je obaviješten.',
      accepted: 'Hvala, narudžba je potvrđena. Gost je obaviješten.',
      declined: 'Upit je odbijen. Gost je obaviješten.',
      proposed: 'Prijedlog je poslan gostu.',
      unchanged: 'Ovo je već zabilježeno.',
      stale: 'Narudžba se promijenila. Ovo je njezina trenutna verzija.',
      rejected: 'Ova radnja više nije moguća.',
    },
    notFoundTitle: 'Poveznica ne vrijedi',
    notFoundText: 'Provjerite jeste li otvorili cijelu poveznicu iz e-pošte.',
    badRequestTitle: 'Zahtjev nije valjan',
    badRequestText: 'Otvorite poveznicu iz e-pošte i pokušajte ponovno.',
  },
  en: {
    title: 'Order',
    other: { lang: 'hr', label: 'Hrvatski' },
    offer: 'Offer',
    date: 'Date',
    time: 'Time',
    /** The quantity's label per price unit; the value is the bare number. */
    quantity: { person: 'Persons', group: 'Groups', item: 'Quantity' },
    guestName: 'Guest',
    guestPhone: 'Guest phone',
    price: 'Price',
    status: {
      waiting: (at: string) => `Waiting for your answer by ${at}`,
      guest: 'Waiting for the guest',
      declined: 'Declined',
      confirmed: 'Confirmed',
      acknowledged: 'Acknowledged',
      cancelled: 'Cancelled',
      closed: 'Closed',
      open: 'In progress',
    },
    acknowledge: 'Got it',
    cannotFulfil: "Can't fulfil",
    accept: 'Accept',
    acceptWithPrice: 'Accept with price',
    suggestTime: 'Suggest another time',
    decline: 'Decline',
    suggestTitle: 'Suggest another time',
    suggestText: 'The guest gets your suggestion and can accept or decline it.',
    priceTitle: 'Accept with price',
    priceText: 'Enter the total price for this order. The guest can accept or decline it.',
    newDate: 'Date',
    newTime: 'Time (optional)',
    totalPrice: 'Total price',
    send: 'Send to the guest',
    formError: {
      date: (from: string, to: string) => `Choose a date from ${from} to ${to}.`,
      time: 'Enter the time as HH:MM.',
      price: 'Enter a price above zero, such as 120 or 120.50.',
      terms: 'These terms are not possible. Check that the time is in the future.',
    },
    confirmTitle: "Can't fulfil this order?",
    confirmText: 'The order will be cancelled, and Fetivi will tell the guest.',
    confirmYes: 'Yes, cancel the order',
    back: 'Back',
    flash: {
      acknowledged: 'Thanks, your acknowledgement is recorded.',
      cancelled: 'The order is cancelled. Fetivi has been told.',
      accepted: 'Thanks, the order is confirmed. The guest has been told.',
      declined: 'The request is declined. The guest has been told.',
      proposed: 'Your suggestion was sent to the guest.',
      unchanged: 'This was already recorded.',
      stale: 'This order changed. Here is its current version.',
      rejected: 'This action is no longer possible.',
    },
    notFoundTitle: 'This link is not valid',
    notFoundText: 'Check that you opened the whole link from the email.',
    badRequestTitle: 'This request is not valid',
    badRequestText: 'Open the link from the email and try again.',
  },
} as const;

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const STYLE = `
:root{--blue-600:#0047ab;--blue-700:#003a8c;--navy-900:#1a2c5b;--sky-100:#e4f3fc;--white:#fff;
--gray-50:#f6f8fb;--gray-200:#e3e8f0;--gray-500:#64748b;--danger:#b42318;--danger-bg:#fdecea;
--success:#0f7b4f;--success-bg:#e3f5ec;--tap:44px}
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:16px;
line-height:1.5;color:var(--navy-900);background:var(--gray-50)}
main{max-width:480px;margin:0 auto;padding:16px}
header{display:flex;align-items:center;justify-content:space-between;min-height:var(--tap)}
.brand{font-weight:700;color:var(--blue-600);letter-spacing:.02em}
header a{display:inline-flex;align-items:center;min-height:var(--tap);color:var(--blue-600)}
h1{font-size:22px;margin:16px 0 4px}
.status{display:inline-block;margin:0 0 16px;padding:2px 10px;border-radius:999px;font-size:14px;
background:var(--sky-100)}
.status.ok{background:var(--success-bg);color:var(--success)}
.status.off{background:var(--gray-200);color:var(--gray-500)}
.status.bad{background:var(--danger-bg);color:var(--danger)}
.flash{margin:0 0 16px;padding:12px;border:1px solid var(--gray-200);border-radius:8px;background:var(--white)}
dl{margin:0 0 24px;padding:0 16px;border:1px solid var(--gray-200);border-radius:12px;background:var(--white)}
dl div{display:flex;justify-content:space-between;gap:16px;padding:12px 0;border-top:1px solid var(--gray-200)}
dl div:first-child{border-top:0}
dt{color:var(--gray-500)}
dd{margin:0;text-align:right;font-weight:600;overflow-wrap:anywhere}
form{display:flex;flex-direction:column;gap:12px;margin:0}
button,.button{display:flex;align-items:center;justify-content:center;width:100%;min-height:var(--tap);
padding:10px 16px;border:1px solid var(--blue-600);border-radius:8px;font:inherit;font-weight:600;
text-decoration:none;cursor:pointer}
.primary{background:var(--blue-600);color:var(--white)}
.primary:hover{background:var(--blue-700)}
.danger{background:var(--white);border-color:#f1c4bf;color:var(--danger)}
.danger:hover{border-color:var(--danger);background:var(--danger-bg)}
.solid-danger{background:var(--danger);border-color:var(--danger);color:var(--white)}
.secondary{background:var(--white);color:var(--blue-600)}
p{margin:0 0 16px}
label{display:flex;flex-direction:column;gap:4px;font-weight:600}
input{width:100%;min-height:var(--tap);padding:8px 12px;border:1px solid var(--gray-500);border-radius:8px;
font:inherit;color:var(--navy-900);background:var(--white)}
input:focus{outline:2px solid var(--blue-600);outline-offset:1px}
.money{display:flex;align-items:center;gap:8px}
.money span{font-weight:400;color:var(--gray-500)}
.error{color:var(--danger);font-weight:600}
`;

function document(lang: ProviderLanguage, title: string, body: string): string {
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} · Fetivi</title>
<style>${STYLE}</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

function header(lang: ProviderLanguage, switchHref: string | null): string {
  const other = STRINGS[lang].other;
  const link = switchHref
    ? `<a href="${escapeHtml(`${switchHref}?lang=${other.lang}`)}" lang="${other.lang}">${other.label}</a>`
    : '';
  return `<header><span class="brand">Fetivi</span>${link}</header>`;
}

/** 'YYYY-MM-DDTHH:mm' as the page shows dates, with the time. */
function localDateTime(value: string, lang: ProviderLanguage): string {
  return `${formatCivilDate(value.slice(0, 10), lang)} ${value.slice(11, 16)}`;
}

function money(minor: number, currency: string, lang: ProviderLanguage): string {
  return new Intl.NumberFormat(lang, { style: 'currency', currency }).format(minor / 100);
}

function statusLine(view: ProviderLinkView, lang: ProviderLanguage): string {
  const s = STRINGS[lang].status;
  if (view.status === 'pending_provider' && view.respondBy) {
    return `<p class="status">${escapeHtml(s.waiting(localDateTime(view.respondBy, lang)))}</p>`;
  }
  if (view.status === 'awaiting_confirmation') return `<p class="status off">${s.guest}</p>`;
  if (view.status === 'declined') return `<p class="status bad">${s.declined}</p>`;
  if (view.status === 'confirmed') {
    return view.acknowledgedAt
      ? `<p class="status ok">${s.acknowledged}</p>`
      : `<p class="status">${s.confirmed}</p>`;
  }
  if (view.status === 'cancelled') return `<p class="status bad">${s.cancelled}</p>`;
  if (view.final) return `<p class="status off">${s.closed}</p>`;
  return `<p class="status off">${s.open}</p>`;
}

function summary(view: ProviderLinkView, lang: ProviderLanguage): string {
  const s = STRINGS[lang];
  const rows: [string, string][] = [
    [s.offer, view.offerTitle],
    [s.date, formatCivilDate(view.date, lang)],
    ...(view.startTime ? [[s.time, view.startTime] as [string, string]] : []),
    [s.quantity[view.priceUnit], String(view.quantity)],
    ...(view.priceMinor !== null
      ? [[s.price, money(view.priceMinor, view.currency, lang)] as [string, string]]
      : []),
    ...(view.guest.name ? [[s.guestName, view.guest.name] as [string, string]] : []),
    ...(view.guest.phone ? [[s.guestPhone, view.guest.phone] as [string, string]] : []),
  ];
  return `<dl>${rows
    .map(([term, value]) => `<div><dt>${term}</dt><dd>${escapeHtml(value)}</dd></div>`)
    .join('')}</dl>`;
}

function hidden(view: ProviderLinkView, lang: ProviderLanguage): string {
  return `<input type="hidden" name="proposalId" value="${escapeHtml(view.proposalId)}"><input type="hidden" name="lang" value="${lang}">`;
}

/** The Order page. `selfPath` is the page's own path, without a query. */
export function renderProviderPage(
  view: ProviderLinkView,
  lang: ProviderLanguage,
  selfPath: string,
  flash?: Flash,
): string {
  const s = STRINGS[lang];
  const button = (action: ProviderLinkAction, style: string, label: string) =>
    view.actions.includes(action)
      ? `<button type="submit" name="action" value="${action}" class="${style}">${label}</button>`
      : '';
  const buttons = [
    button('accept', 'primary', s.accept),
    button('accept_with_price', 'primary', s.acceptWithPrice),
    button('suggest_time', 'secondary', s.suggestTime),
    button('decline', 'danger', s.decline),
    view.actions.includes('acknowledge')
      ? `<button type="submit" name="action" value="acknowledge" class="primary">${s.acknowledge}</button>`
      : '',
    view.actions.includes('cannot_fulfil')
      ? `<button type="submit" name="action" value="cannot_fulfil" class="danger">${s.cannotFulfil}</button>`
      : '',
  ].join('');
  const form = buttons ? `<form method="post">${hidden(view, lang)}${buttons}</form>` : '';
  const body = [
    header(lang, selfPath),
    `<h1>${s.title}</h1>`,
    statusLine(view, lang),
    flash ? `<p class="flash" role="status">${s.flash[flash]}</p>` : '',
    summary(view, lang),
    form,
  ].join('');
  return document(lang, s.title, body);
}

/** The second step of Can't fulfil. */
export function renderCannotFulfilConfirm(
  view: ProviderLinkView,
  lang: ProviderLanguage,
  selfPath: string,
): string {
  const s = STRINGS[lang];
  const body = [
    header(lang, null),
    `<h1>${s.confirmTitle}</h1>`,
    `<p>${s.confirmText}</p>`,
    summary(view, lang),
    `<form method="post">${hidden(view, lang)}`,
    `<button type="submit" name="action" value="cannot_fulfil_confirmed" class="solid-danger">${s.confirmYes}</button>`,
    `<a class="button secondary" href="${escapeHtml(`${selfPath}?lang=${lang}`)}">${s.back}</a>`,
    '</form>',
  ].join('');
  return document(lang, s.confirmTitle, body);
}

/**
 * The second step of Suggest another time (a date in the stay, an optional time, and a price
 * when the Order needs one) or Accept with price (the price only). It writes nothing.
 */
export function renderNewTerms(
  view: ProviderLinkView,
  lang: ProviderLanguage,
  selfPath: string,
  step: 'suggest_time' | 'accept_with_price',
  form: TermsForm,
  error?: FormError,
): string {
  const s = STRINGS[lang];
  const priceOnly = step === 'accept_with_price';
  const title = priceOnly ? s.priceTitle : s.suggestTitle;
  const message =
    error === 'date'
      ? s.formError.date(formatCivilDate(view.stayFrom, lang), formatCivilDate(view.stayTo, lang))
      : error
        ? s.formError[error]
        : '';
  const fields = [
    priceOnly
      ? ''
      : `<label>${s.newDate}<input type="date" name="date" required min="${view.stayFrom}" max="${view.stayTo}" value="${escapeHtml(form.date)}"></label>`,
    priceOnly
      ? ''
      : `<label>${s.newTime}<input type="time" name="time" value="${escapeHtml(form.time)}"></label>`,
    priceOnly || view.needsPrice
      ? `<label>${s.totalPrice}<span class="money"><input type="text" name="price" inputmode="decimal" required autocomplete="off" value="${escapeHtml(form.price)}"><span>${escapeHtml(view.currency)}</span></span></label>`
      : '',
  ].join('');
  const body = [
    header(lang, null),
    `<h1>${title}</h1>`,
    `<p>${priceOnly ? s.priceText : s.suggestText}</p>`,
    message ? `<p class="error" role="alert">${escapeHtml(message)}</p>` : '',
    summary(view, lang),
    `<form method="post">${hidden(view, lang)}${fields}`,
    `<button type="submit" name="action" value="${step}_confirmed" class="primary">${s.send}</button>`,
    `<a class="button secondary" href="${escapeHtml(`${selfPath}?lang=${lang}`)}">${s.back}</a>`,
    '</form>',
  ].join('');
  return document(lang, title, body);
}

/** The same page for every unknown token. */
export function renderNotFound(lang: ProviderLanguage): string {
  const s = STRINGS[lang];
  return document(
    lang,
    s.notFoundTitle,
    `${header(lang, null)}<h1>${s.notFoundTitle}</h1><p>${s.notFoundText}</p>`,
  );
}

export function renderBadRequest(lang: ProviderLanguage): string {
  const s = STRINGS[lang];
  return document(
    lang,
    s.badRequestTitle,
    `${header(lang, null)}<h1>${s.badRequestTitle}</h1><p>${s.badRequestText}</p>`,
  );
}
