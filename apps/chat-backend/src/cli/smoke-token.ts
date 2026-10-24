/**
 * Mints the `stay` server token for a Space, for the post-deploy smoke check (deploy/smoke.sh),
 * which calls the stay MCP server with it through MCP Inspector. It needs the server's own
 * signing key, so it grants nothing that shell access to the server does not already give.
 *
 * The Space's cookie token comes from SMOKE_SPACE_TOKEN, not argv, so it stays out of `ps`.
 * Prints only the token.
 */
import { pathToFileURL } from 'node:url';
import { createDb, type Db, resolveSpace } from '@fetivi/domain';
import { loadConfig } from '../config';
import { loadSigningKey } from '../tokens/keys';
import { mintTurnTokens, type TokenConfig } from '../tokens/mint';

/** The `stay` token for the Space behind a cookie token; null when there is no such Space. */
export async function smokeToken(
  db: Db,
  cfg: TokenConfig,
  spaceToken: string,
  now: Date,
): Promise<string | null> {
  const resolved = await resolveSpace(db, spaceToken, now);
  if (!resolved) return null;
  return (await mintTurnTokens(cfg, db, resolved.space.id, now))?.stay ?? null;
}

async function main(): Promise<void> {
  const spaceToken = process.env.SMOKE_SPACE_TOKEN;
  if (!spaceToken) {
    console.error('Usage: SMOKE_SPACE_TOKEN=<space cookie value> pnpm smoke:token');
    process.exitCode = 1;
    return;
  }
  const config = loadConfig();
  // An ephemeral key would sign a token the MCP servers cannot verify.
  if (!config.GUEST_TOKEN_PRIVATE_KEY) {
    console.error('GUEST_TOKEN_PRIVATE_KEY is not set');
    process.exitCode = 1;
    return;
  }
  const cfg: TokenConfig = {
    key: await loadSigningKey(config.GUEST_TOKEN_PRIVATE_KEY),
    issuer: config.GUEST_TOKEN_ISSUER,
    mcpBaseUrl: config.MCP_PUBLIC_URL,
  };

  const { db, pool } = createDb(config.DATABASE_URL);
  try {
    const token = await smokeToken(db, cfg, spaceToken, new Date());
    if (!token) {
      console.error('no space for that token');
      process.exitCode = 1;
      return;
    }
    console.log(token);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
