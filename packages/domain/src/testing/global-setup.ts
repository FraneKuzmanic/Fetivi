import { buildTemplateDatabase, dropLeftoverTestDatabases } from './database';

export async function setup(): Promise<void> {
  await dropLeftoverTestDatabases();
  await buildTemplateDatabase();
}

export async function teardown(): Promise<void> {
  await dropLeftoverTestDatabases();
}
