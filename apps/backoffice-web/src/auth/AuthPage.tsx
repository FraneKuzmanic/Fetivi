import { Wordmark } from '@fetivi/ui';
import { type ReactNode, useEffect, useRef } from 'react';
import { HarbourHouse } from './HarbourHouse';

/**
 * The frame of every signed-out page: the wordmark, the page's heading and its content, and from
 * 900px a panel about what hosts do here. A new title (a sent or done state) takes focus, so screen
 * readers announce it and keyboard users keep their place.
 */
export function AuthPage({ title, children }: { title: string; children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);

  useEffect(() => {
    const previous = document.title;
    document.title = `${title} · Fetivi`;
    if (first.current) first.current = false;
    else heading.current?.focus();
    return () => {
      document.title = previous;
    };
  }, [title]);

  return (
    <div className="auth">
      <main className="auth-main">
        <Wordmark />
        <h1 ref={heading} tabIndex={-1}>
          {title}
        </h1>
        {children}
      </main>
      <aside className="auth-side" aria-labelledby="auth-side-title">
        <HarbourHouse />
        <h2 id="auth-side-title">Your property, explained to every guest</h2>
        <p>
          Write down the details once: Wi-Fi, check-in, house rules, the places you love. Fetivi
          answers your guests' questions from them, in their own language, and tells you when
          someone needs you.
        </p>
      </aside>
    </div>
  );
}
