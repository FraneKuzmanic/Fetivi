import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { accounts } from '../db/schema/accounts';
import { platformSettings } from '../db/schema/settings';
import {
  DEFAULT_DAILY_MESSAGE_CAP,
  LLM_KEY_LIMITS,
  type LlmKeySource,
  type LlmProvider,
} from './vocabulary';

// The model key lives encrypted on the settings row with its provider and model, and wins over
// ANTHROPIC_API_KEY, which stays as the fallback (68, 71, ADR 0032). Every model caller
// resolves it per call through a source.

/**
 * The model setting in use: one provider, key and model for every task (71). `model` is null
 * for the environment key and for a key saved before 71: each task then uses its own default
 * Anthropic model.
 */
export interface LlmConfig {
  provider: LlmProvider;
  key: string;
  model: string | null;
}

/** Resolves the model setting to use now; undefined = not configured. */
export type LlmSource = () => Promise<LlmConfig | undefined>;

/** A source that always gives the Anthropic `key` with each task's default model (tests, evals). */
export const fixedKey =
  (key: string | undefined): LlmSource =>
  async () =>
    key ? { provider: 'anthropic', key, model: null } : undefined;

export const NOT_CONFIGURED_DETAIL =
  'no model API key: set one in the admin settings or ANTHROPIC_API_KEY';

const IV_BYTES = 12;

const aesKey = (secret: string) => createHash('sha256').update(secret).digest();

/** AES-256-GCM under sha256(secret), as `base64(iv).base64(tag).base64(ciphertext)`. */
export function encryptLlmKey(key: string, secret: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', aesKey(secret), iv);
  const data = Buffer.concat([cipher.update(key, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, data].map((part) => part.toString('base64')).join('.');
}

/** The key, or null when `stored` is malformed, tampered with or under another secret. */
export function decryptLlmKey(stored: string, secret: string): string | null {
  const parts = stored.split('.');
  if (parts.length !== 3) return null;
  const [iv, tag, data] = parts.map((part) => Buffer.from(part, 'base64')) as [
    Buffer,
    Buffer,
    Buffer,
  ];
  if (iv.length !== IV_BYTES || tag.length !== 16) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', aesKey(secret), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export interface LlmKeySourceHandle {
  get: LlmSource;
  /** Drops the cached key, so the next `get` reads the settings row. */
  invalidate(): void;
}

const UNREADABLE_WARNING =
  'The stored model key does not decrypt with LLM_KEY_SECRET: using ANTHROPIC_API_KEY';

/**
 * The settings key, else `envKey`, else undefined; cached per process for `ttlMs`, so a change
 * reaches every process within that time without a restart. A stored key that does not decrypt
 * (LLM_KEY_SECRET rotated) is reported through `warn` and treated as absent.
 */
export function createLlmKeySource(opts: {
  db: Executor;
  envKey: string | undefined;
  secret: string;
  ttlMs?: number;
  now?: () => number;
  warn?: (message: string) => void;
}): LlmKeySourceHandle {
  const ttlMs = opts.ttlMs ?? 30_000;
  const now = opts.now ?? Date.now;
  const envKey = opts.envKey || undefined;
  let cached: { value: LlmConfig | undefined; until: number } | undefined;
  let inFlight: Promise<LlmConfig | undefined> | undefined;
  let generation = 0;

  const read = async (): Promise<LlmConfig | undefined> => {
    const [row] = await opts.db
      .select({
        ciphertext: platformSettings.llmKeyCiphertext,
        provider: platformSettings.llmProvider,
        model: platformSettings.llmModel,
      })
      .from(platformSettings);
    if (row?.ciphertext && row.provider) {
      const key = decryptLlmKey(row.ciphertext, opts.secret);
      if (key !== null) return { provider: row.provider, key, model: row.model };
      opts.warn?.(UNREADABLE_WARNING);
    }
    return envKey ? { provider: 'anthropic', key: envKey, model: null } : undefined;
  };

  return {
    async get() {
      if (cached && now() < cached.until) return cached.value;
      if (!inFlight) {
        const started = generation;
        inFlight = read()
          .then((value) => {
            // An invalidate during the read means the value may be stale: do not cache it.
            if (started === generation) cached = { value, until: now() + ttlMs };
            return value;
          })
          .finally(() => {
            inFlight = undefined;
          });
      }
      return inFlight;
    },
    invalidate() {
      cached = undefined;
      inFlight = undefined;
      generation += 1;
    },
  };
}

function validKey(key: string): string {
  const trimmed = key.trim();
  if (
    trimmed.length < LLM_KEY_LIMITS.min ||
    trimmed.length > LLM_KEY_LIMITS.max ||
    !/^\S+$/.test(trimmed)
  ) {
    throw new RangeError('invalid model key');
  }
  return trimmed;
}

/**
 * Saves the admin's key encrypted with its provider and the chosen model (the caller has checked
 * both with the provider); never touches the message cap.
 */
export async function setLlmKey(
  db: Executor,
  opts: {
    key: string;
    provider: LlmProvider;
    model: string;
    secret: string;
    accountId: string;
    now: Date;
  },
): Promise<void> {
  const key = validKey(opts.key);
  const fields = {
    llmKeyCiphertext: encryptLlmKey(key, opts.secret),
    llmKeyLast4: key.slice(-4),
    llmProvider: opts.provider,
    llmModel: opts.model,
    llmKeyUpdatedAt: opts.now,
    llmKeyUpdatedBy: opts.accountId,
  };
  await db
    .insert(platformSettings)
    .values({ id: 1, dailyMessageCap: DEFAULT_DAILY_MESSAGE_CAP, updatedAt: opts.now, ...fields })
    .onConflictDoUpdate({ target: platformSettings.id, set: fields });
}

/** Changes the model of the saved key (the caller has checked it is the provider's). */
export async function setLlmModel(
  db: Executor,
  opts: { model: string; accountId: string; now: Date },
): Promise<void> {
  await db
    .update(platformSettings)
    .set({ llmModel: opts.model, llmKeyUpdatedAt: opts.now, llmKeyUpdatedBy: opts.accountId });
}

/** Clears the admin's key (the processes fall back to ANTHROPIC_API_KEY); keeps who and when. */
export async function removeLlmKey(
  db: Executor,
  opts: { accountId: string; now: Date },
): Promise<void> {
  const fields = {
    llmKeyCiphertext: null,
    llmKeyLast4: null,
    llmProvider: null,
    llmModel: null,
    llmKeyUpdatedAt: opts.now,
    llmKeyUpdatedBy: opts.accountId,
  };
  await db
    .insert(platformSettings)
    .values({ id: 1, dailyMessageCap: DEFAULT_DAILY_MESSAGE_CAP, updatedAt: opts.now, ...fields })
    .onConflictDoUpdate({ target: platformSettings.id, set: fields });
}

export interface LlmKeyStatus {
  source: LlmKeySource;
  /** The key's provider; the environment key is always Anthropic's. Null with no key. */
  provider: LlmProvider | null;
  /** The one model for every task; null = each task's default Anthropic model. */
  model: string | null;
  last4: string | null;
  updatedAt: Date | null;
  /** The email of the account that last changed the key; null if never changed or deleted. */
  updatedBy: string | null;
}

/**
 * What the admin may see about the key in use, never the key itself. A stored key that does not
 * decrypt with `secret` is not in use, so the status shows the env key or none, as the processes do.
 */
export async function getLlmKeyStatus(
  db: Executor,
  envKey: string | undefined,
  secret: string,
): Promise<LlmKeyStatus> {
  const [row] = await db
    .select({
      ciphertext: platformSettings.llmKeyCiphertext,
      last4: platformSettings.llmKeyLast4,
      provider: platformSettings.llmProvider,
      model: platformSettings.llmModel,
      updatedAt: platformSettings.llmKeyUpdatedAt,
      updatedBy: accounts.email,
    })
    .from(platformSettings)
    .leftJoin(accounts, eq(accounts.id, platformSettings.llmKeyUpdatedBy));
  const changed = { updatedAt: row?.updatedAt ?? null, updatedBy: row?.updatedBy ?? null };
  if (row?.ciphertext && row.last4 && decryptLlmKey(row.ciphertext, secret) !== null) {
    return {
      source: 'settings',
      provider: row.provider,
      model: row.model,
      last4: row.last4,
      ...changed,
    };
  }
  if (envKey) {
    return {
      source: 'environment',
      provider: 'anthropic',
      model: null,
      last4: envKey.slice(-4),
      ...changed,
    };
  }
  return { source: 'none', provider: null, model: null, last4: null, ...changed };
}
