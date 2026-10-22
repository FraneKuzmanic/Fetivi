import {
  QUEUE_OPTIONS,
  QUEUES,
  type SpaceEmailDeps,
  type SpaceEmailJobData,
  sendSpaceEmail,
} from '@fetivi/domain';
import type { JobDefinition } from '../runner';

/** Sends one verification or recovery mail; the job id is the email's idempotency key. */
export function spaceEmailJob(deps: SpaceEmailDeps): JobDefinition<SpaceEmailJobData> {
  return {
    name: QUEUES.spaceEmail,
    queue: QUEUE_OPTIONS.spaceEmail,
    async handler(data, job) {
      if (!job) throw new Error('space-email needs its job id');
      const outcome = await sendSpaceEmail(deps, data, job.id);
      // Ids, purpose and outcome only, never the email or the token.
      console.log(
        JSON.stringify({
          job: QUEUES.spaceEmail,
          purpose: data.purpose,
          spaceId: data.spaceId,
          outcome,
        }),
      );
    },
  };
}
