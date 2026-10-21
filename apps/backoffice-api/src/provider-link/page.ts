import { formatCivilDate, type ProviderLanguage, type ProviderLinkView } from '@fetivi/domain';

// The Provider's order page: server-rendered, no JavaScript, no external requests, one column
// that fits a phone. Colours are the back-office palette (apps/backoffice-web/src/styles.css).

/** What the page says after an action's redirect. */
export const FLASHES = ['acknowledged', 'cancelled', 'unchanged', 'stale', 'rejected'] as const;
export type Flash = (typeof FLASHES)[number];

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
    status: {
      confirmed: 'Potvrđena',
      acknowledged: 'Primitak potvrđen',
      cancelled: 'Otkazana',
      closed: 'Zatvorena',
      open: 'U obradi',
    },
    acknowledge: 'Primljeno',
    cannotFulfil: 'Ne mogu izvršiti',
    confirmTitle: 'Ne možete izvršiti narudžbu?',
    confirmText: 'Narudžba će biti otkazana, a Fetivi će obavijestiti gosta.',
    confirmYes: 'Da, otkaži narudžbu',
    back: 'Natrag',
    flash: {
      acknowledged: 'Hvala, primitak je zabilježen.',
      cancelled: 'Narudžba je otkazana. Fetivi je obaviješten.',
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
    status: {
      confirmed: 'Confirmed',
      acknowledged: 'Acknowledged',
      cancelled: 'Cancelled',
      closed: 'Closed',
      open: 'In progress',
    },
    acknowledge: 'Got it',
    cannotFulfil: "Can't fulfil",
    confirmTitle: "Can't fulfil this order?",
    confirmText: 'The order will be cancelled, and Fetivi will tell the guest.',
    confirmYes: 'Yes, cancel the order',
    back: 'Back',
    flash: {
      acknowledged: 'Thanks, your acknowledgement is recorded.',
      cancelled: 'The order is cancelled. Fetivi has been told.',
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

function statusLine(view: ProviderLinkView, lang: ProviderLanguage): string {
  const s = STRINGS[lang].status;
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
  const buttons = [
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
