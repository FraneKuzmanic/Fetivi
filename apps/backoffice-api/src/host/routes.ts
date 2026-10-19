import { accounts, type Db } from '@fetivi/domain';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { HttpError } from '../http-error';

export async function hostRoutes(app: FastifyInstance, deps: { db: Db }): Promise<void> {
  // The model for every host route: the host id comes only from request.auth, never the client.
  app.get('/api/host/account', { config: { access: 'host' } }, async (request) => {
    const hostId = request.auth.hostId;
    if (!hostId) throw new HttpError(403, 'forbidden');
    const [account] = await deps.db
      .select({ id: accounts.id, email: accounts.email })
      .from(accounts)
      .where(eq(accounts.id, hostId));
    if (!account) throw new HttpError(404, 'not-found');
    return account;
  });
}
