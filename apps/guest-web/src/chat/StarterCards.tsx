import {
  Boat,
  CalendarStar,
  ChatsCircle,
  CloudSun,
  ForkKnife,
  type Icon,
  Path,
  Sailboat,
  WifiHigh,
} from '@phosphor-icons/react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

/** One starter per thing Fetivi can do: the stay, places, events, weather, services, ferries, plans, the host. */
const STARTERS = [
  { key: 'chat.starterWifi', icon: WifiHigh },
  { key: 'chat.starterEat', icon: ForkKnife },
  { key: 'chat.starterEvents', icon: CalendarStar },
  { key: 'chat.starterWeather', icon: CloudSun },
  { key: 'chat.starterBoat', icon: Sailboat },
  { key: 'chat.starterFerry', icon: Boat },
  { key: 'chat.starterPlan', icon: Path },
  { key: 'chat.starterHost', icon: ChatsCircle },
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
