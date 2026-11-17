import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk';
import type { Egress } from '@fetivi/egress';
import { eq } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { accounts } from '../db/schema/accounts';
import { platformSettings } from '../db/schema/settings';
import { DEFAULT_DAILY_MESSAGE_CAP, LLM_KEY_LIMITS, type LlmKeySource } from './vocabulary';

// The Anthropic key lives encrypted on the settings row and wins over ANTHROPIC_API_KEY, which
// stays as the fallback (68, ADR 0032). Every model caller resolves it per call through a source.

/** Resolves the Anthropic key to use now; undefined = not configured. */
export type ApiKeySource = () => Promise<string | undefined>;

/** A source that always gives `key` (tests, live tests, the evaluation harness). */
export const fixedKey =
  (key: string | undefined): ApiKeySource =>
  async () =>
    key || undefined;

export const NOT_CONFIGURED_DETAIL =
  'no Anthropic API key: set one in the admin settings or ANTHROPIC_API_KEY';

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

/** An Anthropic client per key, rebuilt only when the key changes. */
export function anthropicClientCache(fetch: Egress['fetch']): (key: string) => Anthropic {
  let last: { key: string; client: Anthropic } | undefined;
  return (key) => {
    if (last?.key !== key) {
      // The SDK only ever passes a URL string, which the egress fetch accepts.
      const client = new Anthropic({
        apiKey: key,
        fetch: fetch as ClientOptions['fetch'],
        maxRetries: 3,
      });
      last = { key, client };
    }
    return last.client;
  };
}

export interface LlmKeySourceHandle {
  get: ApiKeySource;
  /** Drops the cached key, so the next `get` reads the settings row. */
  invalidate(): void;
}

/**
 * The settings key, else `envKey`, else undefined; cached per process for `ttlMs`, so a change
 * reaches every process within that time without a restart. A stored key that does not decrypt
 * (LLM_KEY_SECRET rotated) is reported through `onUnreadable` and treated as absent.
 */
export function createLlmKeySource(opts: {
  db: Executor;
  envKey: string | undefined;
  secret: string;
  ttlMs?: number;
  now?: () => number;
  onUnreadable?: () => void;
}): LlmKeySourceHandle {
  const ttlMs = opts.ttlMs ?? 30_000;
  const now = opts.now ?? Date.now;
  const envKey = opts.envKey || undefined;
  let cached: { value: string | undefined; until: number } | undefined;
  let inFlight: Promise<string | undefined> | undefined;
  let generation = 0;

  const read = async (): Promise<string | undefined> => {
    const [row] = await opts.db
      .select({ ciphertext: platformSettings.llmKeyCiphertext })
      .from(platformSettings);
    if (row?.ciphertext) {
      const key = decryptLlmKey(row.ciphertext, opts.secret);
      if (key !== null) return key;
      opts.onUnreadable?.();
    }
    return envKey;
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
    throw new RangeError('invalid Anthropic key');
  }
  return trimmed;
}

/** Saves the admin's key encrypted; never touches the message cap. */
export async function setLlmKey(
  db: Executor,
  opts: { key: string; secret: string; accountId: string; now: Date },
): Promise<void> {
  const key = validKey(opts.key);
  const fields = {
    llmKeyCiphertext: encryptLlmKey(key, opts.secret),
    llmKeyLast4: key.slice(-4),
    llmKeyUpdatedAt: opts.now,
    llmKeyUpdatedBy: opts.accountId,
  };
  await db
    .insert(platformSettings)
    .values({ id: 1, dailyMessageCap: DEFAULT_DAILY_MESSAGE_CAP, updatedAt: opts.now, ...fields })
    .onConflictDoUpdate({ target: platformSettings.id, set: fields });
}

/** Clears the admin's key (the processes fall back to ANTHROPIC_API_KEY); keeps who and when. */
export async function removeLlmKey(
  db: Executor,
  opts: { accountId: string; now: Date },
): Promise<void> {
  const fields = {
    llmKeyCiphertext: null,
    llmKeyLast4: null,
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
  last4: string | null;
  updatedAt: Date | null;
  /** The email of the account that last changed the key; null if never changed or deleted. */
  updatedBy: string | null;
}

/** What the admin may see about the key in use; never decrypts, never returns the key. */
export async function getLlmKeyStatus(
  db: Executor,
  envKey: string | undefined,
): Promise<LlmKeyStatus> {
  const [row] = await db
    .select({
      last4: platformSettings.llmKeyLast4,
      updatedAt: platformSettings.llmKeyUpdatedAt,
      updatedBy: accounts.email,
    })
    .from(platformSettings)
    .leftJoin(accounts, eq(accounts.id, platformSettings.llmKeyUpdatedBy));
  const changed = { updatedAt: row?.updatedAt ?? null, updatedBy: row?.updatedBy ?? null };
  if (row?.last4) return { source: 'settings', last4: row.last4, ...changed };
  if (envKey) return { source: 'environment', last4: envKey.slice(-4), ...changed };
  return { source: 'none', last4: null, ...changed };
}
