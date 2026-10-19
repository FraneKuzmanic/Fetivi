import { PgBoss } from 'pg-boss';

export interface JobDefinition<T extends object = object> {
  name: string;
  /** Cron expression in UTC; omit for jobs that are only sent on demand. */
  cron?: string;
  handler: (data: T) => Promise<void>;
}

export interface JobRunnerOptions {
  connectionString: string;
  jobs: readonly JobDefinition[];
  /** Test hook: faster cron and polling intervals. */
  fast?: boolean;
}

export async function startJobRunner(options: JobRunnerOptions): Promise<PgBoss> {
  const { connectionString, jobs, fast = false } = options;
  const boss = new PgBoss({
    connectionString,
    ...(fast ? { cronWorkerIntervalSeconds: 1, cronMonitorIntervalSeconds: 1 } : {}),
  });
  // An unhandled 'error' event would crash the process.
  boss.on('error', (error) => console.error('pg-boss error', error));
  await boss.start();

  for (const job of jobs) {
    await boss.createQueue(job.name);
    await boss.work<object>(job.name, { pollingIntervalSeconds: fast ? 0.5 : 2 }, async (batch) => {
      for (const item of batch) await job.handler(item.data);
    });
    if (job.cron) await boss.schedule(job.name, job.cron);
  }
  return boss;
}
