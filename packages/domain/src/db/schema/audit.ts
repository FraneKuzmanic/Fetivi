import { bigint, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Writes an admin made while acting as a host. No foreign keys: the log outlives deleted accounts. */
export const actAsAudit = pgTable(
  'act_as_audit',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    adminId: uuid('admin_id').notNull(),
    hostId: uuid('host_id').notNull(),
    hostEmail: text('host_email').notNull(),
    method: text('method').notNull(),
    route: text('route').notNull(),
    statusCode: integer('status_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('act_as_audit_created_idx').on(t.createdAt)],
);
