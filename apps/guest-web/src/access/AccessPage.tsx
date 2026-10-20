import type { GuestLanguage } from '@fetivi/domain/vocabulary';
import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { ApiError, checkLink } from '../api';
import { setLanguage } from '../i18n';
import { navigatorLanguages, pickBrowserLanguage } from '../i18n/browser-language';
import { entryDecision, storedLanguage, storeLanguage, useSpace } from '../space';
import { LanguagePicker } from './LanguagePicker';
import { NoLinkPage } from './NoLinkPage';
import { PinForm } from './PinForm';

/** The unit link: language first, then the PIN. A space of this unit goes straight to Chat. */
export function AccessPage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const { state, setSpace } = useSpace();
  const [linkMissing, setLinkMissing] = useState(false);
  const [step, setStep] = useState<'language' | 'pin'>('language');
  const [language, setChosen] = useState<GuestLanguage>(
    () => storedLanguage() ?? pickBrowserLanguage(navigatorLanguages()),
  );
  const heading = useRef<HTMLHeadingElement>(null);
  const decision = entryDecision(state, slug);

  useEffect(() => {
    setLanguage(language);
  }, [language]);

  useEffect(() => {
    let live = true;
    checkLink(slug).catch((error: unknown) => {
      if (live && error instanceof ApiError && error.status === 404) setLinkMissing(true);
    });
    return () => {
      live = false;
    };
  }, [slug]);

  // Each step starts at its heading, so focus follows the flow.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the step change is the trigger.
  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  if (decision === 'shell') return <Navigate to="/chat" replace />;
  if (linkMissing) return <NoLinkPage reason="not-found" />;

  return (
    <main className="access">
      <p className="access-brand">Fetivi</p>
      {step === 'language' ? (
        <LanguagePicker
          headingRef={heading}
          onPick={(picked) => {
            setChosen(picked);
            storeLanguage(picked);
            setStep('pin');
          }}
        />
      ) : (
        <PinForm
          slug={slug}
          language={language}
          headingRef={heading}
          onEntered={(space) => {
            setSpace(space);
            navigate('/chat', { replace: true });
          }}
          onChangeLanguage={() => setStep('language')}
        />
      )}
    </main>
  );
}
