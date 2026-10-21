import { AboutMeRuleError, type Db, getAboutMe, replaceAboutMe } from '@fetivi/domain';
import type { FastifyPluginAsync } from 'fastify';
import { spaceOf } from '../access/plugin';
import { HttpError } from '../http-error';
import { aboutMeBody } from './schemas';

export interface AboutMeRouteDeps {
  db: Db;
  now: () => Date;
}

export const aboutMeRoutes: FastifyPluginAsync<AboutMeRouteDeps> = async (app, { db, now }) => {
  /** What is kept about this Space's guests: codes only, never names. */
  app.get('/api/about-me', { config: { access: 'space' } }, async (request) => ({
    aboutMe: await getAboutMe(db, spaceOf(request).space.id),
  }));

  /** The guest's own tap: the only way special-category needs are stored. After the Stay only removals. */
  app.put('/api/about-me', { config: { access: 'space' } }, async (request) => {
    const resolved = spaceOf(request);
    const next = aboutMeBody.parse(request.body);
    try {
      return {
        aboutMe: await replaceAboutMe(db, resolved.space.id, next, now(), {
          removalsOnly: resolved.closed,
        }),
      };
    } catch (error) {
      if (error instanceof AboutMeRuleError) throw new HttpError(409, 'space-closed');
      throw error;
    }
  });
};
