import { Wordmark } from '@fetivi/ui';
import { type ReactNode, useEffect, useRef } from 'react';
import { HarbourHouse } from './HarbourHouse';

const PITCH = 'Your property, explained to every guest';

/**
 * The frame of every signed-out page: the wordmark, the page's heading and its content. On a phone
 * the wordmark and a small harbour house form one header ("Fetivi on the quay"); `intro` adds the
 * line on what hosts do here, for first visits. From 900px the header gives way to a side panel
 * with the full scene and that line. A new title (a sent or done state) takes focus, so screen
 * readers announce it and keyboard users keep their place.
 */
export function AuthPage({
  title,
  intro = false,
  children,
}: {
  title: string;
  intro?: boolean;
  children: ReactNode;
}) {
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
      <header className="auth-masthead">
        <div className="auth-masthead-row">
          <Wordmark />
          <HarbourHouse className="auth-masthead-scene" />
        </div>
        {intro ? <p className="auth-masthead-line">{PITCH}</p> : null}
      </header>
      <main className="auth-main">
        <Wordmark />
        <h1 ref={heading} tabIndex={-1}>
          {title}
        </h1>
        {children}
      </main>
      <aside className="auth-side" aria-labelledby="auth-side-title">
        <HarbourHouse />
        <h2 id="auth-side-title">{PITCH}</h2>
        <p>
          Write down the details once: Wi-Fi, check-in, house rules, the places you love. Fetivi
          answers your guests' questions from them, in their own language, and tells you when
          someone needs you.
        </p>
      </aside>
    </div>
  );
}
