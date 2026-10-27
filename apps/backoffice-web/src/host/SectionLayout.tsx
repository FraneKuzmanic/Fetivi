import { CaretRight, type Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';

export interface PageSection {
  id: string;
  label: string;
  icon: Icon;
  /** A short state after the label, such as "Not set" or a count. */
  note?: string;
  /** How many things the section holds, shown as a quiet count. */
  count?: number;
  /** Opens another page instead of a section here (Host picks). */
  to?: string;
}

/**
 * A long editor split into sections shown one at a time: a list of sections beside the open one
 * on a wide screen, a row of tabs that scrolls sideways above it on a phone. The open section
 * lives in `?section=`, so a link can point at one and Back returns to the previous.
 */
export function SectionLayout({
  sections,
  label,
  render,
}: {
  sections: PageSection[];
  /** Names the list for screen readers, e.g. "Property sections". */
  label: string;
  render: (id: string) => ReactNode;
}) {
  const [params, setParams] = useSearchParams();
  const local = sections.filter((s) => !s.to);
  const asked = params.get('section');
  const active = local.find((s) => s.id === asked)?.id ?? local[0]?.id ?? '';

  const open = (id: string) =>
    setParams(
      (p) => {
        p.set('section', id);
        return p;
      },
      { replace: false },
    );

  return (
    <div className="section-layout">
      <nav className="section-nav" aria-label={label}>
        <ul>
          {sections.map((s) => (
            <li key={s.id}>
              {s.to ? (
                <Link to={s.to} className="section-link">
                  <s.icon aria-hidden="true" />
                  <span className="section-label">{s.label}</span>
                  <CaretRight className="section-out" aria-hidden="true" />
                </Link>
              ) : (
                <a
                  href={`?section=${s.id}`}
                  className="section-link"
                  aria-current={s.id === active ? 'true' : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    open(s.id);
                  }}
                >
                  <s.icon aria-hidden="true" weight={s.id === active ? 'fill' : 'regular'} />
                  <span className="section-label">{s.label}</span>
                  {s.note ? <span className="section-note">{s.note}</span> : null}
                  {s.count ? <span className="tab-count section-count">{s.count}</span> : null}
                </a>
              )}
            </li>
          ))}
        </ul>
      </nav>
      <div className="section-body">{render(active)}</div>
    </div>
  );
}
