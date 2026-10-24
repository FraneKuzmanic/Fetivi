import { FEEDBACK_REASONS, type FeedbackReason } from '@fetivi/domain/feedback-vocabulary';
import { ThumbsDown, ThumbsUp } from '@phosphor-icons/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type AnswerRating, putFeedback } from './feedback-api';

const NONE: AnswerRating = { thumb: null, reason: null };

const REASON_KEYS = {
  wrong: 'feedback.reasonWrong',
  outdated: 'feedback.reasonOutdated',
  not_helpful: 'feedback.reasonNotHelpful',
} as const satisfies Record<FeedbackReason, string>;

/**
 * Thumbs up or down under one of Fetivi's answers, with a one-tap reason after a thumbs down
 * (43 AC 1). Saved at once; a failed save puts the previous rating back.
 */
export function AnswerFeedback({
  messageId,
  initial = NONE,
}: {
  messageId: string;
  initial?: AnswerRating;
}) {
  const { t } = useTranslation();
  const [rating, setRating] = useState<AnswerRating>(initial);
  const [saved, setSaved] = useState<'idle' | 'thanks' | 'failed'>('idle');

  const save = (next: AnswerRating) => {
    const before = rating;
    setRating(next);
    setSaved('idle');
    putFeedback(messageId, next).then(
      () => setSaved(next.thumb ? 'thanks' : 'idle'),
      () => {
        setRating(before);
        setSaved('failed');
      },
    );
  };

  // Tapping the pressed thumb clears the rating.
  const thumb = (value: 'up' | 'down') =>
    save(rating.thumb === value ? NONE : { thumb: value, reason: null });

  return (
    <div className="answer-feedback">
      <div className="answer-feedback-thumbs">
        <button
          type="button"
          className="answer-feedback-thumb"
          aria-pressed={rating.thumb === 'up'}
          aria-label={t('feedback.up')}
          onClick={() => thumb('up')}
        >
          <ThumbsUp aria-hidden weight={rating.thumb === 'up' ? 'fill' : 'regular'} />
        </button>
        <button
          type="button"
          className="answer-feedback-thumb"
          aria-pressed={rating.thumb === 'down'}
          aria-label={t('feedback.down')}
          onClick={() => thumb('down')}
        >
          <ThumbsDown aria-hidden weight={rating.thumb === 'down' ? 'fill' : 'regular'} />
        </button>
      </div>
      {rating.thumb === 'down' && (
        <fieldset
          className="fv-chips answer-feedback-reasons"
          aria-label={t('feedback.reasonsLabel')}
        >
          {FEEDBACK_REASONS.map((reason) => (
            <button
              key={reason}
              type="button"
              className="fv-chip"
              aria-pressed={rating.reason === reason}
              onClick={() => save({ thumb: 'down', reason })}
            >
              {t(REASON_KEYS[reason])}
            </button>
          ))}
        </fieldset>
      )}
      <p className="answer-feedback-note" role="status">
        {saved === 'thanks' ? t('feedback.thanks') : ''}
      </p>
      {saved === 'failed' && (
        <p className="answer-feedback-note failed" role="alert">
          {t('feedback.failed')}
        </p>
      )}
    </div>
  );
}
