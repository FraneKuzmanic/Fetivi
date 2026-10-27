import type { ComponentProps } from 'react';
import Markdown, { type Components } from 'react-markdown';

/** Links leave the app in a new tab, without giving the page a handle on this one. */
const ExternalLink = ({ node: _node, ...props }: ComponentProps<'a'> & { node?: unknown }) => (
  <a {...props} target="_blank" rel="noopener noreferrer" />
);

// A block sits under the page's h1 and its own h2 title: its headings start at h3.
const shift =
  (Tag: 'h3' | 'h4' | 'h5' | 'h6') =>
  ({ node: _node, ...props }: ComponentProps<'h3'> & { node?: unknown }) => <Tag {...props} />;

const COMPONENTS: Components = {
  a: ExternalLink,
  h1: shift('h3'),
  h2: shift('h4'),
  h3: shift('h5'),
  h4: shift('h6'),
  h5: shift('h6'),
  h6: shift('h6'),
};

const SUBHEADING_MAX = 48;

/**
 * Hosts write topic lines ("Washing machine") as short paragraphs of their own, not as Markdown
 * headings. A one-line paragraph that is short, ends without punctuation and is followed by more
 * text is such a line.
 */
function isTopicLine(paragraph: string, next: string | undefined): boolean {
  const text = paragraph.trim();
  return (
    next !== undefined &&
    text.length > 0 &&
    text.length <= SUBHEADING_MAX &&
    !text.includes('\n') &&
    !/[.!?:,;)]$/.test(text) &&
    // Markdown or HTML syntax (lists, quotes, links, images, tables, code, raw tags) is never one.
    !/^([#>*+\-<!|`[]|\d+[.)])/.test(text)
  );
}

const paragraphsOf = (markdown: string) =>
  markdown
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .filter((p) => p.trim() !== '');

/** The topic lines of a block, in order: shown under its title so a closed block says what's in it. */
export function topicsOf(markdown: string): string[] {
  const paragraphs = paragraphsOf(markdown);
  return paragraphs.filter((p, i) => isTopicLine(p, paragraphs[i + 1])).map((p) => p.trim());
}

/**
 * The Markdown with each topic line made a heading, and the host's line breaks kept: they write
 * one fact per line ("Phone: …", "E-mail: …"), which Markdown would run together.
 */
export function withTopicHeadings(markdown: string): string {
  const paragraphs = paragraphsOf(markdown);
  return paragraphs
    .map((p, i) =>
      isTopicLine(p, paragraphs[i + 1]) ? `# ${p.trim()}` : p.replace(/[ \t]*\n/g, '  \n'),
    )
    .join('\n\n');
}

/**
 * A block's Markdown. Raw HTML is never rendered (react-markdown skips it without rehype-raw), and
 * images are dropped so host text cannot make a guest's browser load another site.
 */
export function BlockBody({ markdown }: { markdown: string }) {
  return (
    <div className="block-body">
      <Markdown skipHtml disallowedElements={['img']} unwrapDisallowed components={COMPONENTS}>
        {withTopicHeadings(markdown)}
      </Markdown>
    </div>
  );
}
