import { findConversation, loadMessages, type MessagePart } from '@fetivi/domain';
import type { FastifyPluginAsync } from 'fastify';
import { spaceOf } from '../access/plugin';
import { chatBody } from './schemas';
import { type ChatDeps, rowToUiMessage, runTurn } from './turn';

const shown = (part: MessagePart) => part.type === 'text' || part.type.startsWith('tool-');

export const chatRoutes: FastifyPluginAsync<ChatDeps> = async (app, deps) => {
  /** The guest's chat history: their messages and Fetivi's, without system notes. */
  app.get('/api/chat', { config: { access: 'space' } }, async (request) => {
    const conversation = await findConversation(deps.db, spaceOf(request).space.id);
    if (!conversation) return { messages: [] };
    const rows = await loadMessages(deps.db, conversation.id);
    return {
      messages: rows
        .filter((r) => r.role !== 'system' && r.kind === 'chat')
        .map((r) => rowToUiMessage({ ...r, parts: r.parts.filter(shown) })),
    };
  });

  /** One turn, answered as an AI SDK UI message stream (SSE). */
  app.post('/api/chat', { config: { access: 'space' } }, async (request) => {
    const { text } = chatBody.parse(request.body);
    return runTurn(deps, spaceOf(request), text);
  });
};
