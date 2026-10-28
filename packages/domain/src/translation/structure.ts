// The structure check of architecture §4.3: a translation must keep the source's Markdown
// skeleton, its links and its {{placeholders}}. Pure; used by the job and on host corrections.

export interface BlockText {
  title: string;
  body: string;
}

const HEADING = /^(#{1,6})\s+\S/;
export const BULLET = /^\s*[-*+]\s+\S/;
const STEP = /^\s*(\d+)[.)]\s+\S/;
/**
 * One link, scanned left to right: a Markdown link `[text](target "title")`, an autolink
 * `<scheme:…>`, or a bare http(s), mailto: or tel: URL. Only the target is compared, so a model
 * that wraps a bare URL as `[url](url)` keeps the link.
 */
const LINK =
  /\[[^\]]*\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)|<((?:https?|mailto|tel):[^>\s]+)>|\b((?:https?:\/\/|mailto:|tel:)[^\s<>"'()[\]]+)/g;
/** Sentence punctuation after a bare URL belongs to the sentence, which a translation may move. */
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;
const PLACEHOLDER = /\{\{\s*[A-Za-z0-9_.-]+\s*\}\}/g;

const lines = (text: string) => text.split('\n').map((line) => line.trimEnd());

function headings(text: string): number[] {
  return lines(text).flatMap((line) => {
    const match = HEADING.exec(line);
    return match?.[1] ? [match[1].length] : [];
  });
}

const bullets = (text: string) => lines(text).filter((line) => BULLET.test(line)).length;

function steps(text: string): number[] {
  return lines(text).flatMap((line) => {
    const match = STEP.exec(line);
    return match?.[1] ? [Number(match[1])] : [];
  });
}

const all = (text: string, pattern: RegExp) => text.match(pattern) ?? [];

/** The targets of every link in `text`, in order. */
function linkTargets(text: string): string[] {
  return [...text.matchAll(LINK)].map(
    ([, markdown, autolink, bare]) =>
      markdown ?? autolink ?? (bare ?? '').replace(TRAILING_PUNCTUATION, ''),
  );
}
const countOf = (text: string, char: string) => text.split(char).length - 1;

const show = (values: readonly unknown[]) => `[${values.join(',')}]`;
const same = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((value, i) => value === b[i]);

/** Links and placeholders: the rules that apply to plain text as well as Markdown. */
function checkInline(field: string, source: string, output: string, problems: string[]) {
  const links = [linkTargets(source), linkTargets(output)] as const;
  if (!same(...links)) problems.push(`${field}: links ${show(links[0])} vs ${show(links[1])}`);
  const placeholders = [all(source, PLACEHOLDER), all(output, PLACEHOLDER)] as const;
  if (!same(...placeholders)) {
    problems.push(`${field}: placeholders ${show(placeholders[0])} vs ${show(placeholders[1])}`);
  }
  for (const brace of ['{', '}']) {
    const counts = [countOf(source, brace), countOf(output, brace)] as const;
    if (counts[0] !== counts[1]) {
      problems.push(`${field}: '${brace}' count ${counts[0]} vs ${counts[1]}`);
    }
  }
}

/** Every way `output` breaks the structure of `source`; empty when it keeps it. */
export function checkStructure(source: BlockText, output: BlockText): string[] {
  const problems: string[] = [];
  checkInline('title', source.title, output.title, problems);

  const h = [headings(source.body), headings(output.body)] as const;
  if (!same(...h)) problems.push(`body: headings ${show(h[0])} vs ${show(h[1])}`);
  const b = [bullets(source.body), bullets(output.body)] as const;
  if (b[0] !== b[1]) problems.push(`body: list items ${b[0]} vs ${b[1]}`);
  const s = [steps(source.body), steps(output.body)] as const;
  if (!same(...s)) problems.push(`body: steps ${show(s[0])} vs ${show(s[1])}`);
  checkInline('body', source.body, output.body, problems);
  return problems;
}
