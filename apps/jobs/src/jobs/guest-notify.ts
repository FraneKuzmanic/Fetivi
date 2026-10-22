import {
  deliverGuestNotification,
  dueStayNotices,
  enqueueGuestNotification,
  GUEST_REMINDERS_CRON,
  type GuestNotifyDeps,
  type GuestNotifyJobData,
  type JobQueue,
  QUEUE_OPTIONS,
  QUEUES,
} from '@fetivi/domain';
import type { JobDefinition } from '../runner';

/** Sends one guest notification on its channels, once per channel (reminders and host replies). */
export function guestNotifyJob(deps: GuestNotifyDeps): JobDefinition<GuestNotifyJobData> {
  return {
    name: QUEUES.guestNotify,
    queue: QUEUE_OPTIONS.guestNotify,
    async handler(data) {
      const outcome = await deliverGuestNotification(deps, data);
      // Ids, kind and outcome only, never contact fields.
      console.log(
        JSON.stringify({
          job: QUEUES.guestNotify,
          kind: data.kind,
          spaceId: data.spaceId,
          orderId: data.orderId,
          handoffId: data.handoffId,
          outcome,
        }),
      );
    },
  };
}

/**
 * Every 15 minutes: one guest-notify job per due arrival or checkout notice. The job id comes from
 * the notice's key, so an overlapping, repeated or caught-up run adds nothing.
 */
export function guestRemindersJob(
  deps: Pick<GuestNotifyDeps, 'db' | 'now'> & { queue: JobQueue },
): JobDefinition {
  return {
    name: QUEUES.guestReminders,
    queue: QUEUE_OPTIONS.guestReminders,
    cron: GUEST_REMINDERS_CRON,
    async handler() {
      const due = await dueStayNotices(deps.db, deps.now());
      for (const data of due) await enqueueGuestNotification(deps.db, deps.queue, data);
      console.log(JSON.stringify({ job: QUEUES.guestReminders, due: due.length }));
    },
  };
}
