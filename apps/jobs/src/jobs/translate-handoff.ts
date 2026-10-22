import {
  type Db,
  type HandoffPart,
  type HandoffTranslator,
  type JobQueue,
  QUEUE_OPTIONS,
  QUEUES,
  runHandoffTranslation,
} from '@fetivi/domain';
import type { JobDefinition } from '../runner';

export interface HandoffJobDeps {
  db: Db;
  queue: JobQueue;
  now: () => Date;
  handoffTranslator: HandoffTranslator;
}

/** Translates a Host message for the host, or the host's reply for the guest, and delivers it. */
export function translateHandoffJob(
  deps: HandoffJobDeps,
): JobDefinition<{ handoffId: string; part: HandoffPart }> {
  return {
    name: QUEUES.translateHandoff,
    queue: QUEUE_OPTIONS.translateHandoff,
    async handler({ handoffId, part }) {
      const result = await runHandoffTranslation(deps, { handoffId, part });
      // Never the message, the reply or a translation.
      console.log(JSON.stringify({ job: QUEUES.translateHandoff, handoffId, part, result }));
    },
  };
}
