import { Clock, type Icon, Key, ListChecks, MapTrifold, WifiHigh } from '@phosphor-icons/react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

const STARTERS = [
  { key: 'chat.starterWifi', icon: WifiHigh },
  { key: 'chat.starterTimes', icon: Clock },
  { key: 'chat.starterAccess', icon: Key },
  { key: 'chat.starterRules', icon: ListChecks },
  { key: 'chat.starterAround', icon: MapTrifold },
] as const satisfies readonly { key: string; icon: Icon }[];

/** Questions to start with; each sends its own text. */
export function StarterCards({ onSend }: { onSend: (text: string) => void }) {
  const { t } = useTranslation();
  const label = useId();
  return (
    <div className="starters">
      <p id={label} className="starters-label">
        {t('chat.startersLabel')}
      </p>
      <ul aria-labelledby={label}>
        {STARTERS.map(({ key, icon: StarterIcon }) => (
          <li key={key}>
            <button type="button" className="starter" onClick={() => onSend(t(key))}>
              <StarterIcon aria-hidden="true" />
              {t(key)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
