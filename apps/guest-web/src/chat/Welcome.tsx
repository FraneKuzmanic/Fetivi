import { useTranslation } from 'react-i18next';
import { Mascot } from '../shell/Mascot';

/** The fixed, pre-written welcome; always first, never stored. Shaped like any Fetivi answer. */
export function Welcome() {
  const { t } = useTranslation();
  return (
    <div className="fetivi-row">
      <span className="avatar">
        <Mascot className="avatar-mascot" />
      </span>
      <div className="fetivi-turn">
        <p className="bubble fetivi">
          <span className="visually-hidden">{`${t('chat.fetivi')}: `}</span>
          {t('chat.welcome')}
        </p>
      </div>
    </div>
  );
}
