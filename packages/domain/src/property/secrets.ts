// Advisory only: a block that looks like it holds a secret still saves, the host gets a warning.
// Secrets belong in typed fields so the guest projection can gate them; block text is shown freely.

export interface SecretWarning {
  kind: 'phone' | 'code' | 'password';
  excerpt: string;
}

const PHONE = /\+?\d[\d ()/-]{6,}\d/g;
const CODE_AFTER_KEYWORD =
  /(?<!\p{L})(?:code|pin|kod|šifra|sifra|lozinka|key|lock|lockbox|keypad|door)[^\d\n]{0,20}?[#*]?\d{3,8}[#*]?(?!\d)/giu;
const KEYPAD = /(?<!\d)\d{4,8}#/g;
const PASSWORD = /(?<!\p{L})(?:password|passwort|lozinka|wifi|wi-fi)\s*[:=]\s*\S+/giu;

const MAX_EXCERPT = 40;

function excerpt(match: string): string {
  const text = match.trim().replace(/\s+/g, ' ');
  return text.length > MAX_EXCERPT ? `${text.slice(0, MAX_EXCERPT - 1)}…` : text;
}

/** Text that looks like a phone number, a door or key code, or a password. */
export function findSecretLikeText(text: string): SecretWarning[] {
  const warnings: SecretWarning[] = [];
  const add = (kind: SecretWarning['kind'], match: string) => {
    const e = excerpt(match);
    if (!warnings.some((w) => w.kind === kind && w.excerpt === e))
      warnings.push({ kind, excerpt: e });
  };

  for (const [match] of text.matchAll(PHONE)) {
    if ((match.match(/\d/g) ?? []).length >= 8) add('phone', match);
  }
  for (const [match] of text.matchAll(CODE_AFTER_KEYWORD)) add('code', match);
  for (const [match] of text.matchAll(KEYPAD)) add('code', match);
  for (const [match] of text.matchAll(PASSWORD)) add('password', match);
  return warnings;
}
