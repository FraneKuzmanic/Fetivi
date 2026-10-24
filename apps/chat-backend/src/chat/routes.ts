import {
  FeedbackRuleError,
  findConversation,
  listConversationFeedback,
  loadMessages,
  type MessagePart,
  setAnswerFeedback,
} from '@fetivi/domain';
import {
  COMPONENT_PART_TYPE,
  ELICITATION_PART_TYPE,
  INBOX_PART_TYPE,
  MCP_APP_PART_TYPE,
} from '@fetivi/ui/payloads';
import type { FastifyPluginAsync } from 'fastify';
import { spaceOf } from '../access/plugin';
import { HttpError } from '../http-error';
import { chatBody, feedbackBody, messageParams } from './schemas';
import { type ChatDeps, resumeTurn, rowToUiMessage, runTurn } from './turn';

const shown = (part: MessagePart) =>
  part.type === 'text' ||
  part.type.startsWith('tool-') ||
  part.type === COMPONENT_PART_TYPE ||
  part.type === ELICITATION_PART_TYPE ||
  part.type === INBOX_PART_TYPE ||
  part.type === MCP_APP_PART_TYPE;

export const chatRoutes: FastifyPluginAsync<ChatDeps> = async (app, deps) => {
  /** The guest's chat history: their messages, Fetivi's and inbox messages, without system notes. */
  app.get('/api/chat', { config: { access: 'space' } }, async (request) => {
    const conversation = await findConversation(deps.db, spaceOf(request).space.id);
    if (!conversation) return { messages: [], feedback: {} };
    const rows = await loadMessages(deps.db, conversation.id);
    return {
      messages: rows
        .filter((r) => r.role !== 'system')
        .map((r) => rowToUiMessage({ ...r, parts: r.parts.filter(shown) })),
      feedback: await listConversationFeedback(deps.db, conversation.id),
    };
  });

  /**
   * The guest's thumb and one-tap reason on one of Fetivi's answers (43 AC 1, AC 2). Allowed
   * after checkout too: it stores no conversation content and needs no model.
   */
  app.put('/api/chat/messages/:id/feedback', { config: { access: 'space' } }, async (request) => {
    const { id } = messageParams.parse(request.params);
    const body = feedbackBody.parse(request.body);
    try {
      const feedback = await setAnswerFeedback(deps.db, {
        spaceId: spaceOf(request).space.id,
        messageId: id,
        ...body,
        now: deps.now(),
      });
      return { feedback };
    } catch (error) {
      if (!(error instanceof FeedbackRuleError)) throw error;
      throw error.code === 'not-found'
        ? new HttpError(404, 'not-found')
        : new HttpError(400, 'invalid-input');
    }
  });

  /** One turn, or the guest's answer to a card, answered as an AI SDK UI message stream (SSE). */
  app.post('/api/chat', { config: { access: 'space' } }, async (request) => {
    const body = chatBody.parse(request.body);
    return 'text' in body
      ? runTurn(deps, spaceOf(request), body.text)
      : resumeTurn(deps, spaceOf(request), body.answer);
  });
};
