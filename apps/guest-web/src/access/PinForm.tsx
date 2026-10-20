import type { GuestLanguage } from '@fetivi/domain/vocabulary';
import { Translate } from '@phosphor-icons/react';
import type { TFunction } from 'i18next';
import { type FormEvent, type Ref, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, enterPin, type Space } from '../api';
import { MascotSays } from '../shell/Mascot';

/** 75 → "1:15". */
export function formatWait(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export type Problem = 'wrong' | 'wait' | 'network' | 'not-found';

/** The message under the input. The wait counts down with `waitLeft` and goes when it ends. */
export function pinMessage(t: TFunction, problem: Problem | null, waitLeft: number): string {
  const wait = waitLeft > 0 ? t('pin.wait', { time: formatWait(waitLeft) }) : '';
  switch (problem) {
    case 'wrong':
      return wait ? `${t('pin.wrong')} ${wait}` : t('pin.wrong');
    case 'wait':
      return wait;
    case 'not-found':
      return t('link.notFound');
    case 'network':
      return t('error.network');
    default:
      return '';
  }
}

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
  // Said once per attempt; the visible message then counts down without interrupting.
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    if (waitLeft <= 0) return;
    const timer = setTimeout(() => {
      setWaitLeft((s) => s - 1);
      // The spoken wait is over too; leave no stale time for a screen reader to find.
      if (waitLeft === 1) setAnnouncement('');
    }, 1000);
    return () => clearTimeout(timer);
  }, [waitLeft]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pin.length !== 6 || busy || waitLeft > 0) return;
    setBusy(true);
    setProblem(null);
    setAnnouncement('');
    try {
      onEntered(await enterPin(slug, pin, language));
    } catch (error) {
      let next: Problem = 'network';
      let seconds = 0;
      if (error instanceof ApiError && (error.status === 401 || error.status === 429)) {
        seconds = error.retryAfter ?? 0;
        next = error.status === 401 ? 'wrong' : 'wait';
        if (error.status === 401) setPin('');
      } else if (error instanceof ApiError && error.status === 404) {
        next = 'not-found';
      }
      setWaitLeft(seconds);
      setProblem(next);
      setAnnouncement(pinMessage(t, next, seconds));
    } finally {
      setBusy(false);
    }
  }

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
        <p id="pin-message" className="message">
          {pinMessage(t, problem, waitLeft)}
        </p>
        <p className="visually-hidden" role="status">
          {announcement}
        </p>
        <button
          type="submit"
          className="button block"
          disabled={pin.length !== 6 || busy || waitLeft > 0}
        >
          {t('pin.submit')}
        </button>
      </form>
      <button type="button" className="text-button" onClick={onChangeLanguage}>
        <Translate aria-hidden="true" />
        {t('pin.changeLanguage')}
      </button>
    </>
  );
}
