import { COMPONENT_PART_TYPE } from '@fetivi/ui/payloads';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { api } from '../api';

/** The guest's conversation so far: their messages and Fetivi's, oldest first. */
export const getChatHistory = () => api<{ messages: UIMessage[] }>('/api/chat');

/** A message's text parts joined; tool parts are not shown. */
export function messageText(message: UIMessage): string {
  return message.parts
    .map((p) => (p.type === 'text' ? p.text : ''))
    .filter(Boolean)
    .join('\n');
}

/** A Fetivi component part (validated again before it renders). */
export const isComponentPart = (
  part: UIMessage['parts'][number],
): part is { type: typeof COMPONENT_PART_TYPE; id?: string; data: unknown } =>
  part.type === COMPONENT_PART_TYPE;

/** The text of the newest guest message: the only thing the server is sent. */
export function lastUserText(messages: UIMessage[]): string {
  const last = messages.findLast((m) => m.role === 'user');
  return last ? messageText(last) : '';
}

export type ChatErrorKey = 'chat.errorClosed' | 'chat.errorBusy' | 'chat.errorTurn';

/** The transport puts the error body (`{"error":"<code>"}`) or the stream's error text in the message. */
export function chatErrorKey(error: Error): ChatErrorKey {
  if (error.message.includes('space-closed')) return 'chat.errorClosed';
  if (error.message.includes('turn-in-progress')) return 'chat.errorBusy';
  return 'chat.errorTurn';
}

/** The server holds the history, so each request carries only the new text. */
export const chatTransport = new DefaultChatTransport<UIMessage>({
  api: '/api/chat',
  credentials: 'same-origin',
  prepareSendMessagesRequest: ({ messages }) => ({ body: { text: lastUserText(messages) } }),
});
