import type { InboxItem } from '@fetivi/ui/payloads';
import { useTranslation } from 'react-i18next';

/**
 * An inbox message in the Chat: the host's reply, in the host's own bubble without Fetivi's
 * mascot. A translated reply says so and keeps the host's words one tap away.
 */
export function InboxPart({ item }: { item: InboxItem }) {
  const { t } = useTranslation();
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
