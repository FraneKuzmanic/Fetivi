import {
  deliverHostDigest,
  deliverHostMessageNotification,
  dueDigests,
  enqueueHostNotification,
  HOST_DIGESTS_CRON,
  type HostNotifyDeps,
  type HostNotifyJobData,
  type JobQueue,
  QUEUE_OPTIONS,
  QUEUES,
} from '@fetivi/domain';
import type { JobDefinition } from '../runner';

/** Tells a host about a Host message (immediate path, urgent bypass) or sends a digest slot. */
export function hostNotifyJob(deps: HostNotifyDeps): JobDefinition<HostNotifyJobData> {
  return {
    name: QUEUES.hostNotify,
    queue: QUEUE_OPTIONS.hostNotify,
    async handler(data) {
      if (data.kind === 'message') {
        const result = await deliverHostMessageNotification(deps, data.handoffId);
        // Ids, kind and outcome only, never the host's address.
        console.log(
          JSON.stringify({
            job: QUEUES.hostNotify,
            kind: data.kind,
            handoffId: data.handoffId,
            ...result,
          }),
        );
        return;
      }
      const result = await deliverHostDigest(deps, { hostId: data.hostId, slot: data.slot });
      console.log(
        JSON.stringify({
          job: QUEUES.hostNotify,
          kind: data.kind,
          hostId: data.hostId,
          slot: data.slot,
          ...result,
        }),
      );
    },
  };
}

/**
 * Every 5 minutes: one host-notify digest job per Digest-mode host whose latest slot has pending
 * messages. The job id comes from the host and the slot, so a repeated run adds nothing.
 */
export function hostDigestsJob(
  deps: Pick<HostNotifyDeps, 'db' | 'now'> & { queue: JobQueue },
): JobDefinition {
  return {
    name: QUEUES.hostDigests,
    queue: QUEUE_OPTIONS.hostDigests,
    cron: HOST_DIGESTS_CRON,
    async handler() {
      const due = await dueDigests(deps.db, deps.now());
      for (const { hostId, slot } of due) {
        await enqueueHostNotification(deps.db, deps.queue, { kind: 'digest', hostId, slot });
      }
      console.log(JSON.stringify({ job: QUEUES.hostDigests, due: due.length }));
    },
  };
}
