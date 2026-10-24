import type { FeedbackReason, Thumb } from '@fetivi/domain/feedback-vocabulary';
import { api } from '../../api';

/** The guest's rating of one answer; a reason only goes with a thumbs down (43 AC 1). */
export type AnswerRating = { thumb: Thumb | null; reason: FeedbackReason | null };

export const putFeedback = (messageId: string, rating: AnswerRating) =>
  api<{ feedback: AnswerRating }>(`/api/chat/messages/${encodeURIComponent(messageId)}/feedback`, {
    method: 'PUT',
    body: rating,
  });
