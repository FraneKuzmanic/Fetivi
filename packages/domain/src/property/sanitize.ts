// Host input is untrusted (architecture §4.3): markup is removed before it is stored.

const COMMENT = /<!--[\s\S]*?(?:-->|$)/g;
const SCRIPT_OR_STYLE = /<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi;
/** A tag needs a name followed by whitespace, `/` or `>`, so `5 < 6` and `<https://…>` survive. */
const TAG = /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:[\s/][^>]*)?>/g;

/** Control characters other than tab and newline. */
function isControl(code: number): boolean {
  return (code < 0x20 && code !== 0x09 && code !== 0x0a) || (code >= 0x7f && code <= 0x9f);
}

function removeControl(s: string): string {
  let out = '';
  for (const ch of s) {
    if (!isControl(ch.codePointAt(0) ?? 0)) out += ch;
  }
  return out;
}

function removeHtml(s: string): string {
  return s.replace(COMMENT, '').replace(SCRIPT_OR_STYLE, '').replace(TAG, '');
}

/** For Markdown block bodies: removes HTML and control characters, keeps Markdown and newlines. */
export function stripMarkdownHtml(s: string): string {
  return removeControl(removeHtml(s.replace(/\r\n?/g, '\n'))).trim();
}

/** For plain-text fields. `singleLine` also folds line breaks into spaces (names, phones, codes). */
export function stripMarkup(s: string, options: { singleLine?: boolean } = {}): string {
  const text = stripMarkdownHtml(s);
  return options.singleLine ? text.replace(/\s*\n\s*/g, ' ') : text;
}
