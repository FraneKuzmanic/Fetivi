import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://fetivi:fetivi@127.0.0.1:5433/fetivi',
  },
  extensionsFilters: ['postgis'],
});
