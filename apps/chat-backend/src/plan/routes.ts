import { type Db, loadSituation } from '@fetivi/domain';
import { dayPlan } from '@fetivi/ui/payloads';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { spaceOf } from '../access/plugin';
import { HttpError } from '../http-error';
import type { ToolBinding, TurnTools } from '../tools/registry';

export interface PlanRouteDeps {
  db: Db;
  now: () => Date;
  tools: ToolBinding;
}

const read = z.object({ plan: dayPlan });

export const planRoutes: FastifyPluginAsync<PlanRouteDeps> = async (app, deps) => {
  /**
   * My trip → Plan: read-only, also after checkout; the tab calls the permitted tool directly,
   * without a model (architecture §4.3).
   */
  app.get('/api/plan', { config: { access: 'space' } }, async (request) => {
    const now = deps.now();
    const ctx = await loadSituation(deps.db, spaceOf(request).space.id, now);
    if (!ctx) throw new HttpError(401, 'no-space');
    let tools: TurnTools | null = null;
    try {
      tools = await deps.tools.open(ctx, now);
      const tool = (await tools.list()).find(
        (l) => l.server === 'trip' && l.tool.name === 'get_plan',
      );
      if (!tool) throw new Error('get_plan not listed');
      return { plan: read.parse(await tools.call(tool, {})).plan };
    } catch (error) {
      request.log.error({ err: error }, 'plan not read');
      throw new HttpError(502, 'plan-unavailable');
    } finally {
      await tools?.close();
    }
  });
};
