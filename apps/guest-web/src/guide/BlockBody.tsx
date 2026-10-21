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

/**
 * A block's Markdown. Raw HTML is never rendered (react-markdown skips it without rehype-raw), and
 * images are dropped so host text cannot make a guest's browser load another site.
 */
export function BlockBody({ markdown }: { markdown: string }) {
  return (
    <div className="block-body">
      <Markdown skipHtml disallowedElements={['img']} unwrapDisallowed components={COMPONENTS}>
        {markdown}
      </Markdown>
    </div>
  );
}
