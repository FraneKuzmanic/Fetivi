import { findConversation, loadMessages, type MessagePart } from '@fetivi/domain';
import {
  COMPONENT_PART_TYPE,
  ELICITATION_PART_TYPE,
  INBOX_PART_TYPE,
  MCP_APP_PART_TYPE,
} from '@fetivi/ui/payloads';
import type { FastifyPluginAsync } from 'fastify';
import { spaceOf } from '../access/plugin';
import { chatBody } from './schemas';
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
    if (!conversation) return { messages: [] };
    const rows = await loadMessages(deps.db, conversation.id);
    return {
      messages: rows
        .filter((r) => r.role !== 'system')
        .map((r) => rowToUiMessage({ ...r, parts: r.parts.filter(shown) })),
    };
  });

  /** One turn, or the guest's answer to a card, answered as an AI SDK UI message stream (SSE). */
  app.post('/api/chat', { config: { access: 'space' } }, async (request) => {
    const body = chatBody.parse(request.body);
    return 'text' in body
      ? runTurn(deps, spaceOf(request), body.text)
      : resumeTurn(deps, spaceOf(request), body.answer);
  });
};
