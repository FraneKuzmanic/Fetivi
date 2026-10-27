import type { Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

/**
 * What a list shows when it has nothing yet: what will appear here, and the one thing to do now.
 * It sits in the list's place, in the same bordered frame, so the page keeps its shape.
 */
export function EmptyState({
  icon: Glyph,
  title,
  children,
  action,
  art,
}: {
  icon?: Icon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  /** An illustration in place of the icon, for the few pages that earn one. */
  art?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {art ??
        (Glyph ? (
          <span className="empty-icon" aria-hidden="true">
            <Glyph />
          </span>
        ) : null)}
      <div className="empty-text">
        <p className="empty-title">{title}</p>
        {children ? <p className="muted">{children}</p> : null}
      </div>
      {action ? <div className="actions">{action}</div> : null}
    </div>
  );
}
