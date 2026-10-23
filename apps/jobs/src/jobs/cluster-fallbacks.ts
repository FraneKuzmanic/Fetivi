import {
  CLUSTER_FALLBACKS_CRON,
  clusterFallbackTopics,
  type Executor,
  QUEUE_OPTIONS,
  QUEUES,
} from '@fetivi/domain';
import type { JobDefinition } from '../runner';

export interface ClusterFallbacksDeps {
  db: Executor;
  now: () => Date;
}

/**
 * Monday 03:00 UTC: groups the previous ISO week's web fallback topics into one curation item per
 * destination and topic group. The dedupe key makes a rerun add nothing.
 */
export function clusterFallbacksJob(deps: ClusterFallbacksDeps): JobDefinition {
  return {
    name: QUEUES.clusterFallbacks,
    queue: QUEUE_OPTIONS.clusterFallbacks,
    cron: CLUSTER_FALLBACKS_CRON,
    async handler() {
      const { rows, clusters, created } = await clusterFallbackTopics(deps.db, deps.now());
      // Counts only: topics derive from guest questions.
      console.log(JSON.stringify({ job: QUEUES.clusterFallbacks, rows, clusters, created }));
    },
  };
}
