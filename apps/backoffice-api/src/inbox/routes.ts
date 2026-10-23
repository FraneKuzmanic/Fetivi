import {
  type Db,
  getHostInboxMessage,
  HandoffRuleError,
  hostOrdersWaiting,
  type JobQueue,
  listHostInbox,
  listHostOrders,
  markHandoffRead,
  replyToHandoff,
  unreadCount,
} from '@fetivi/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { principalOf } from '../auth/plugin';
import { type ErrorCode, HttpError } from '../http-error';
import { hostIdOf } from '../stays/routes';
import { InboxIdParams, InboxReply } from './schemas';

export interface InboxDeps {
  db: Db;
  queue: JobQueue;
  now: () => Date;
}

const INBOX_ERROR_STATUS: Partial<Record<HandoffRuleError['code'], number>> = {
  'not-found': 404,
  'already-replied': 409,
  'invalid-input': 400,
};

async function withInboxErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof HandoffRuleError) {
      const status = INBOX_ERROR_STATUS[error.code];
      if (status) throw new HttpError(status, error.code as ErrorCode);
    }
    throw error;
  }
}

/** Only the host's own session makes a message Read: an admin acting as the host never does. */
const isHostThemself = (request: FastifyRequest) => principalOf(request).actingAs === null;

/**
 * The host's Handoff inbox (PRD §6.6): only what guests explicitly sent, translated into the
 * host's language. Immediate delivery: a sent message is listed at once. Act-as writes are
 * audited by the auth plugin.
 */
export async function inboxRoutes(app: FastifyInstance, deps: InboxDeps): Promise<void> {
  const { db } = deps;
  const host = { config: { access: 'host' as const } };
  const idOf = (request: FastifyRequest) => InboxIdParams.parse(request.params).id;

  app.get('/api/host/inbox', host, async (request) => {
    const hostId = hostIdOf(request);
    // Orders on the host's own services sit beside the messages (38); `unread` stays messages.
    const [messages, unread, orders, ordersWaiting] = await Promise.all([
      listHostInbox(db, hostId),
      unreadCount(db, hostId),
      listHostOrders(db, hostId, deps.now()),
      hostOrdersWaiting(db, hostId),
    ]);
    return { messages, unread, orders, ordersWaiting };
  });

  app.post('/api/host/inbox/:id/read', host, async (request, reply) => {
    const hostId = hostIdOf(request);
    const id = idOf(request);
    await withInboxErrors(async () => {
      if (isHostThemself(request)) {
        await markHandoffRead(db, { hostId, id, now: deps.now() });
      } else if (!(await getHostInboxMessage(db, hostId, id))) {
        throw new HandoffRuleError('not-found');
      }
    });
    return reply.status(204).send();
  });

  app.post('/api/host/inbox/:id/reply', host, async (request) => {
    const hostId = hostIdOf(request);
    const id = idOf(request);
    const { text } = InboxReply.parse(request.body);
    const message = await withInboxErrors(() =>
      replyToHandoff(deps, {
        hostId,
        accountId: principalOf(request).account.id,
        id,
        text,
        markRead: isHostThemself(request),
      }),
    );
    return { message };
  });
}
