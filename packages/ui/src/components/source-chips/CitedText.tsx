import type { FallbackSourceKind } from '@fetivi/domain/fallback-vocabulary';
import { ArrowSquareOut } from '@phosphor-icons/react';
import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { WebResultsPayload } from '../../payloads';
import { parseCitations, siteName } from './citations';
import { SourceChip } from './SourceChip';

/** Every visible string of a citation; the app translates them. */
export interface CitationLabels {
  kind: (kind: FallbackSourceKind) => string;
  notChecked: string;
  /** Only for screen readers, after the link. */
  opensInNewTab: string;
  /** The badge's accessible name, e.g. "Source: visittrogir.hr". */
  open: (site: string) => string;
}

// Long enough to move the pointer from the badge onto its preview.
const HOVER_CLOSE_MS = 150;

type Open = { at: number; pinned: boolean };

/**
 * An answer's text with its `[n]` markers as small badges of the cited site. A badge opens a
 * preview of the web result (hover with a mouse, a tap or Enter/Space otherwise); Escape closes it
 * and returns focus to the badge. All spans, so it sits inside the bubble's paragraph.
 */
export function CitedText({
  text,
  results,
  labels,
}: {
  text: string;
  results: WebResultsPayload['results'];
  labels: CitationLabels;
}) {
  const id = useId();
  const [open, setOpen] = useState<Open | null>(null);
  const badges = useRef(new Map<number, HTMLButtonElement>());
  const popover = useRef<HTMLSpanElement>(null);
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const segments = parseCitations(text, results.length);

  const keep = () => {
    if (closing.current) clearTimeout(closing.current);
    closing.current = null;
  };
  const close = (focusBadge: boolean) => {
    keep();
    if (focusBadge && open) badges.current.get(open.at)?.focus();
    setOpen(null);
  };
  const leave = () => {
    if (!open || open.pinned) return;
    keep();
    closing.current = setTimeout(() => setOpen(null), HOVER_CLOSE_MS);
  };

  useEffect(
    () => () => {
      if (closing.current) clearTimeout(closing.current);
    },
    [],
  );

  // A press anywhere else closes the preview.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (popover.current?.contains(target) || badges.current.get(open.at)?.contains(target)) {
        return;
      }
      setOpen(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // Under the badge's line, across the turn's column (the nearest positioned ancestor).
  // Again on resize: the text rewraps and the badge moves. Opened by a tap or a key, it scrolls
  // clear of the composer (the page's scroll padding); a hover never scrolls the page.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const pop = popover.current;
      const badge = badges.current.get(open.at);
      const parent = pop?.offsetParent;
      if (!pop || !badge || !parent) return;
      const top = badge.getBoundingClientRect().bottom - parent.getBoundingClientRect().top + 4;
      pop.style.top = `${top}px`;
    };
    place();
    if (open.pinned) popover.current?.scrollIntoView?.({ block: 'nearest' });
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault();
    close(true);
  };

  const popId = `${id}-pop`;

  return segments.map((segment, at) => {
    // Segments only grow at the end while the answer streams, so their position is their key.
    // biome-ignore lint/suspicious/noArrayIndexKey: positions are stable.
    if ('text' in segment) return <span key={at}>{segment.text}</span>;
    const result = results[segment.ref];
    if (!result) return null;
    const expanded = open?.at === at;
    return (
      // biome-ignore lint/suspicious/noArrayIndexKey: positions are stable.
      <Fragment key={at}>
        <button
          ref={(el) => {
            if (el) badges.current.set(at, el);
            else badges.current.delete(at);
          }}
          type="button"
          className="fv-cite"
          aria-expanded={expanded}
          aria-controls={expanded ? popId : undefined}
          aria-label={labels.open(result.source.host)}
          onClick={() => {
            keep();
            // A click on a preview opened by hovering keeps it open.
            if (expanded && !open?.pinned) setOpen({ at, pinned: true });
            else setOpen(expanded ? null : { at, pinned: true });
          }}
          onPointerEnter={(event) => {
            if (event.pointerType !== 'mouse') return;
            keep();
            if (!open?.pinned) setOpen({ at, pinned: false });
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === 'mouse') leave();
          }}
          onKeyDown={onKeyDown}
        >
          {siteName(result.source.host)}
        </button>
        {expanded && (
          // Right after its badge, so Tab reaches the link next.
          <span
            ref={popover}
            id={popId}
            role="dialog"
            aria-label={result.title}
            className="fv-cite-pop"
            onPointerEnter={(event) => {
              if (event.pointerType === 'mouse') keep();
            }}
            onPointerLeave={(event) => {
              if (event.pointerType === 'mouse') leave();
            }}
            onKeyDown={onKeyDown}
          >
            <a
              className="fv-cite-pop-title"
              href={result.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
            >
              {result.title}
              <ArrowSquareOut size={16} aria-hidden="true" />
              <span className="fv-visually-hidden"> ({labels.opensInNewTab})</span>
            </a>
            <SourceChip host={result.source.host} kind={result.source.kind} labels={labels} />
            {result.snippet && <span className="fv-cite-pop-snippet">{result.snippet}</span>}
            <span className="fv-cite-pop-note">{labels.notChecked}</span>
          </span>
        )}
      </Fragment>
    );
  });
}
