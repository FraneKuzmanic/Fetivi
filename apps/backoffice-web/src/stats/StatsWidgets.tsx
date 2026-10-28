// The guest-stats widgets shared by the host's unit stats and the admin's feedback page (43).
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { AnswerTotals, TopicCount } from '../api';
import { useLabels } from '../i18n/useLabels';

/** A share as a whole percent; "—" when there is nothing to share yet. */
export function percent(part: number, whole: number): string {
  return whole === 0 ? '—' : `${Math.round((part / whole) * 100)}%`;
}

/** Thumbs up over rated answers (43); "—" before any answer is rated. */
export const thumbsRatio = (up: number, down: number): string => percent(up, up + down);

/** Conversations, answers and the helpful share as plain labelled figures, one row. */
export function Figures({ totals }: { totals: AnswerTotals }) {
  const { t } = useTranslation();
  return (
    <dl className="figures">
      <div>
        <dt>{t('stats.conversations')}</dt>
        <dd>{totals.conversations}</dd>
      </div>
      <div>
        <dt>{t('stats.answers')}</dt>
        <dd>{totals.answers}</dd>
      </div>
      <div>
        <dt>{t('stats.helpful')}</dt>
        <dd>
          {thumbsRatio(totals.up, totals.down)}
          <span className="figure-note">
            {t('misc.upDown', { up: totals.up, down: totals.down })}
          </span>
        </dd>
      </div>
    </dl>
  );
}

/** What answers were about, most asked first, with a bar for scanning. */
export function TopTopics({ topics }: { topics: TopicCount[] }) {
  const labels = useLabels();
  const { t } = useTranslation();
  const headingId = useId();
  const max = Math.max(1, ...topics.map((t) => t.count));
  return (
    <section className="panel" aria-labelledby={headingId}>
      <h2 id={headingId}>{t('stats.topTopics')}</h2>
      {topics.length > 0 ? (
        <ol className="topic-list">
          {topics.map((t) => (
            <li key={t.topic} className="topic-row">
              <span className="topic-name">{labels.answerTopic[t.topic]}</span>
              <span className="topic-count">{t.count}</span>
              <span className="topic-bar" aria-hidden="true">
                <span style={{ width: `${(t.count / max) * 100}%` }} />
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">{t('misc.noAnswers')}</p>
      )}
    </section>
  );
}
