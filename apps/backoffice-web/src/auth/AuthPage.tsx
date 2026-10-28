import { Wordmark } from '@fetivi/ui';
import { type ReactNode, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitch } from '../shell/LanguageSwitch';
import { HarbourHouse } from './HarbourHouse';

/**
 * The frame of every signed-out page: the wordmark, the page's heading and its content. On a phone
 * the wordmark and a small harbour house form one header ("Fetivi on the quay"); `intro` adds the
 * line on what hosts do here, for first visits. From 900px the header gives way to a side panel
 * with the full scene and that line. A new title (a sent or done state) takes focus, so screen
 * readers announce it and keyboard users keep their place; a title that changed only because the
 * language switched does not, so focus stays on the switch.
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
  const { t, i18n } = useTranslation(['auth', 'shell']);
  const language = i18n.language;
  const heading = useRef<HTMLHeadingElement>(null);
  const shown = useRef<{ title: string; language: string } | null>(null);

  useEffect(() => {
    const previous = document.title;
    document.title = t('shell:documentTitle', { page: title });
    const before = shown.current;
    shown.current = { title, language };
    if (before && before.language === language && before.title !== title) heading.current?.focus();
    return () => {
      document.title = previous;
    };
  }, [title, language, t]);

  return (
    <div className="auth">
      <header className="auth-masthead">
        <div className="auth-masthead-row">
          <Wordmark />
          <HarbourHouse className="auth-masthead-scene" />
        </div>
        {intro ? <p className="auth-masthead-line">{t('pitch')}</p> : null}
      </header>
      <main className="auth-main">
        <LanguageSwitch />
        <Wordmark />
        <h1 ref={heading} tabIndex={-1}>
          {title}
        </h1>
        {children}
      </main>
      <aside className="auth-side" aria-labelledby="auth-side-title">
        <HarbourHouse />
        <h2 id="auth-side-title">{t('pitch')}</h2>
        <p>{t('pitchBody')}</p>
      </aside>
    </div>
  );
}
