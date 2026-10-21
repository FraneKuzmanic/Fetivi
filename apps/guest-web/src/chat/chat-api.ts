import { COMPONENT_PART_TYPE, ELICITATION_PART_TYPE } from '@fetivi/ui/payloads';
import { DefaultChatTransport, isToolUIPart, type UIMessage } from 'ai';
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

/** An Order confirmation card's part; its id is the paused tool call's id. */
export const isElicitationPart = (
  part: UIMessage['parts'][number],
): part is { type: typeof ELICITATION_PART_TYPE; id?: string; data: unknown } =>
  part.type === ELICITATION_PART_TYPE;

/** The guest's answer to a card, as the card puts it on the tool part until the server replies. */
export interface GuestAnswerOutput {
  kind: 'guest-answer';
  /** Tells one tap from another, so a tap is sent once (see `hasGuestAnswer`). */
  nonce: string;
  action: 'accept' | 'cancel';
  content?: Record<string, string>;
}

export const isGuestAnswer = (output: unknown): output is GuestAnswerOutput =>
  typeof output === 'object' &&
  output !== null &&
  (output as { kind?: unknown }).kind === 'guest-answer';

/** The guest's answer waiting on a message, with its call id; null when there is none. */
export function guestAnswerOf(
  message: UIMessage | undefined,
): (GuestAnswerOutput & { toolCallId: string }) | null {
  if (message?.role !== 'assistant') return null;
  for (const part of message.parts) {
    if (isToolUIPart(part) && part.state === 'output-available' && isGuestAnswer(part.output)) {
      return { ...part.output, toolCallId: part.toolCallId };
    }
  }
  return null;
}

// Taps already sent. The server's real output replaces a tap's; if it asks again instead, the
// tap stays on the part and must not be sent a second time by itself.
const sentAnswers = new Set<string>();

/**
 * Sends a request by itself once the guest tapped a card. Not
 * lastAssistantMessageIsCompleteWithToolCalls: that is also true after an ordinary answer ending
 * in a tool call, which would resubmit in a loop.
 */
export function hasGuestAnswer({ messages }: { messages: UIMessage[] }): boolean {
  const answer = guestAnswerOf(messages.at(-1));
  return answer !== null && !sentAnswers.has(answer.nonce);
}

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

/**
 * A failed answer to a card. The server may have stored it before the stream broke, so the chat
 * reloads and then tells what it shows: an open card can take another tap; with the card gone
 * (`nothing-to-answer`, or the answer went through) the reloaded answer says the rest.
 */
export function answerErrorKey(
  error: Error,
  cardOpen: boolean,
): ChatErrorKey | 'order.errorAnswer' | null {
  const key = chatErrorKey(error);
  if (key !== 'chat.errorTurn') return key;
  return cardOpen ? 'order.errorAnswer' : null;
}

/**
 * The server holds the history, so each request carries only the new text, or the guest's
 * answer to a card (never the card's state: the server takes that from its own copy).
 */
export const chatTransport = new DefaultChatTransport<UIMessage>({
  api: '/api/chat',
  credentials: 'same-origin',
  prepareSendMessagesRequest: ({ messages }) => {
    const answer = guestAnswerOf(messages.at(-1));
    if (!answer) return { body: { text: lastUserText(messages) } };
    sentAnswers.add(answer.nonce);
    const { toolCallId, action, content } = answer;
    return { body: { answer: { toolCallId, action, ...(content ? { content } : {}) } } };
  },
});
