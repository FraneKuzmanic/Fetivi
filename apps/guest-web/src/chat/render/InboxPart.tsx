import { CALENDAR_SOURCE_LABELS } from '@fetivi/domain/calendar-vocabulary';
import { NOTICE_PATHS } from '@fetivi/domain/notification-vocabulary';
import type { InboxItem } from '@fetivi/ui/payloads';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Mascot } from '../../shell/Mascot';
import { noticeText } from './labels';

/** Stands in for the platform name, so the name can be a link inside the translated sentence. */
const PLATFORM_SLOT = '\u0000';

/**
 * An inbox message in the Chat. The host's reply sits in the host's own bubble without Fetivi's
 * mascot; a translated reply says so and keeps the host's words one tap away. A notice (an Order
 * or Stay notification) is Fetivi speaking, worded here in the current language.
 */
export function InboxPart({ item }: { item: InboxItem }) {
  const { t } = useTranslation();
  if (item.kind === 'notice') return <NoticePart notice={item} />;
  return (
    <div className="host-row">
      <div className="bubble host">
        <p className="host-from">{t('hostMessage.fromHost')}</p>
        <p className="host-text">{item.text}</p>
        {item.original !== null && (
          <details className="host-original">
            <summary>
              {t('hostMessage.translated')} · {t('hostMessage.showOriginal')}
            </summary>
            <p>{item.original}</p>
          </details>
        )}
      </div>
    </div>
  );
}

function NoticePart({ notice }: { notice: Extract<InboxItem, { kind: 'notice' }> }) {
  const { t, i18n } = useTranslation();
  const words = noticeText(t, i18n.language, notice);
  if (!words) return null;
  const path = NOTICE_PATHS[notice.notification];
  const platform = notice.reviewPlatform;
  const [beforeName, afterName] =
    platform && notice.reviewUrl
      ? t('notice.review', { platform: PLATFORM_SLOT }).split(PLATFORM_SLOT)
      : [];
  return (
    <div className="fetivi-row">
      <span className="avatar">
        <Mascot className="avatar-mascot" />
      </span>
      <div className="fetivi-turn">
        <div className="bubble fetivi notice">
          <p>{words.text}</p>
          {words.checkoutBy && <p>{words.checkoutBy}</p>}
          {platform && notice.reviewUrl && (
            <p>
              {beforeName}
              <a href={notice.reviewUrl} target="_blank" rel="noopener noreferrer">
                {CALENDAR_SOURCE_LABELS[platform]}
              </a>
              {afterName}
            </p>
          )}
        </div>
        {path !== '/chat' && (
          <Link to={path} className="text-button">
            {t(path === '/trip' ? 'notice.seeTrip' : 'notice.openGuide')}
          </Link>
        )}
      </div>
    </div>
  );
}
