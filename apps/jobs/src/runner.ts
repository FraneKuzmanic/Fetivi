import { PgBoss, type Queue } from 'pg-boss';

export interface JobDefinition<T extends object = object> {
  name: string;
  /** Queue options such as retries; applied when the queue is first created. */
  queue?: Omit<Queue, 'name'>;
  /** Cron expression in UTC; omit for jobs that are only sent on demand. */
  cron?: string;
  /** The runner always passes `job`; tests that call a handler directly may leave it out. */
  handler: (data: T, job?: { id: string }) => Promise<void>;
}

export interface JobRunnerOptions {
  connectionString: string;
  /** The jobs, or a factory for jobs that need the started boss (to send jobs themselves). */
  jobs: readonly JobDefinition[] | ((boss: PgBoss) => readonly JobDefinition[]);
  /** Test hook: faster cron and polling intervals. */
  fast?: boolean;
}

export async function startJobRunner(options: JobRunnerOptions): Promise<PgBoss> {
  const { connectionString, fast = false } = options;
  const boss = new PgBoss({
    connectionString,
    ...(fast ? { cronWorkerIntervalSeconds: 1, cronMonitorIntervalSeconds: 1 } : {}),
  });
  // An unhandled 'error' event would crash the process.
  boss.on('error', (error) => console.error('pg-boss error', error));
  await boss.start();

  const jobs = typeof options.jobs === 'function' ? options.jobs(boss) : options.jobs;
  for (const job of jobs) {
    await boss.createQueue(job.name, job.queue);
    await boss.work<object>(job.name, { pollingIntervalSeconds: fast ? 0.5 : 2 }, async (batch) => {
      for (const item of batch) await job.handler(item.data, { id: item.id });
    });
    if (job.cron) await boss.schedule(job.name, job.cron);
  }
  return boss;
}
