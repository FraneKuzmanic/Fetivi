import { sql } from 'drizzle-orm';
import { check, integer, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { LLM_PROVIDERS } from '../../settings/vocabulary';
import { accounts } from './accounts';

/** One row: the admin's platform-wide settings. No row = the defaults. */
export const platformSettings = pgTable(
  'platform_settings',
  {
    id: smallint('id').primaryKey().default(1),
    /** Guest chat messages per Space per property day; then chat pauses until the next day. */
    dailyMessageCap: integer('daily_message_cap').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    /**
     * The admin's model key, AES-256-GCM under sha256(LLM_KEY_SECRET) (68). Null = use
     * ANTHROPIC_API_KEY. Only the last four characters are kept in clear, for the admin to see.
     */
    llmKeyCiphertext: text('llm_key_ciphertext'),
    llmKeyLast4: text('llm_key_last4'),
    /** The key's provider (71), set with the key. */
    llmProvider: text('llm_provider', { enum: LLM_PROVIDERS }),
    /** The one model for every task (71); null = each task's own default Anthropic model. */
    llmModel: text('llm_model'),
    /** Kept after a remove, so the admin sees who removed the key and when. */
    llmKeyUpdatedAt: timestamp('llm_key_updated_at', { withTimezone: true }),
    llmKeyUpdatedBy: uuid('llm_key_updated_by').references(() => accounts.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    check('platform_settings_single_row', sql`${t.id} = 1`),
    check('platform_settings_cap_check', sql`${t.dailyMessageCap} between 1 and 1000`),
    check(
      'platform_settings_llm_key_check',
      sql`(${t.llmKeyCiphertext} is null) = (${t.llmKeyLast4} is null)`,
    ),
    check(
      'platform_settings_llm_provider_check',
      sql`(${t.llmKeyCiphertext} is null) = (${t.llmProvider} is null)`,
    ),
  ],
);
