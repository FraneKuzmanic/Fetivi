import type { GuestLanguage } from '@fetivi/domain/vocabulary';
import { Translate } from '@phosphor-icons/react';
import { type FormEvent, type Ref, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, enterPin, type Space } from '../api';
import { MascotSays } from '../shell/Mascot';

/** 75 → "1:15". */
export function formatWait(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

type Problem =
  | { kind: 'wrong' | 'wait'; seconds: number }
  | { kind: 'network' }
  | { kind: 'not-found' };

export function PinForm({
  slug,
  language,
  onEntered,
  onChangeLanguage,
  headingRef,
}: {
  slug: string;
  language: GuestLanguage;
  onEntered: (space: Space) => void;
  onChangeLanguage: () => void;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const { t } = useTranslation();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [waitLeft, setWaitLeft] = useState(0);

  useEffect(() => {
    if (waitLeft <= 0) return;
    const timer = setTimeout(() => setWaitLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [waitLeft]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pin.length !== 6 || busy || waitLeft > 0) return;
    setBusy(true);
    setProblem(null);
    try {
      onEntered(await enterPin(slug, pin, language));
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 429)) {
        const seconds = error.retryAfter ?? 0;
        setWaitLeft(seconds);
        if (error.status === 401) {
          setProblem({ kind: 'wrong', seconds });
          setPin('');
        } else {
          setProblem({ kind: 'wait', seconds });
        }
      } else if (error instanceof ApiError && error.status === 404) {
        setProblem({ kind: 'not-found' });
      } else {
        setProblem({ kind: 'network' });
      }
    } finally {
      setBusy(false);
    }
  }

  // Announced once per attempt; the live countdown is on the button, hidden from screen readers.
  const wait = (seconds: number) => t('pin.wait', { time: formatWait(seconds) });
  let message = '';
  if (problem?.kind === 'wrong') {
    message = problem.seconds > 0 ? `${t('pin.wrong')} ${wait(problem.seconds)}` : t('pin.wrong');
  } else if (problem?.kind === 'wait') message = wait(problem.seconds);
  else if (problem?.kind === 'not-found') message = t('link.notFound');
  else if (problem?.kind === 'network') message = t('error.network');

  return (
    <>
      <h1 ref={headingRef} tabIndex={-1}>
        {t('pin.title')}
      </h1>
      <MascotSays>{t('pin.hint')}</MascotSays>
      <form className="pin-form" onSubmit={submit} noValidate>
        <label htmlFor="pin">{t('pin.label')}</label>
        <input
          id="pin"
          className="pin-input"
          name="pin"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          value={pin}
          aria-describedby="pin-message"
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
        />
        <p id="pin-message" className="message" aria-live="polite">
          {message}
        </p>
        <button
          type="submit"
          className="button block"
          disabled={pin.length !== 6 || busy || waitLeft > 0}
        >
          {t('pin.submit')}
          {waitLeft > 0 && <span aria-hidden="true">({formatWait(waitLeft)})</span>}
        </button>
      </form>
      <button type="button" className="text-button" onClick={onChangeLanguage}>
        <Translate aria-hidden="true" />
        {t('pin.changeLanguage')}
      </button>
    </>
  );
}
