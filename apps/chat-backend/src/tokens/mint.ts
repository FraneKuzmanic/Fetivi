import {
  type Db,
  GUEST_TOKEN_ALG,
  GUEST_TOKEN_TTL_SECONDS,
  GUEST_TOKEN_TYPE,
  loadSituation,
  MCP_SERVERS,
  type McpServerName,
  type SpaceContext,
  scopesFor,
  serverUrl,
} from '@fetivi/domain';
import { SignJWT } from 'jose';
import type { SigningKey } from './keys';

export interface TokenConfig {
  key: SigningKey;
  issuer: string;
  /** Base of the servers' canonical URLs. */
  mcpBaseUrl: string;
}

export type TurnTokens = Record<McpServerName, string>;

const seconds = (d: Date) => Math.floor(d.getTime() / 1000);

/**
 * One token per first-party server for this turn; the browser never sees them. Minted for closed
 * spaces too: after checkout the scopes are already reduced.
 */
export async function mintServerTokens(
  cfg: TokenConfig,
  ctx: SpaceContext,
  now: Date,
): Promise<TurnTokens> {
  const iat = seconds(now);
  const entries = await Promise.all(
    MCP_SERVERS.map(async (server) => {
      const token = await new SignJWT({
        stay: ctx.stayId,
        unit: ctx.unitId,
        property: ctx.propertyId,
        destination: ctx.destinationId,
        lang: ctx.language,
        scope: scopesFor(server, ctx).join(' '),
      })
        .setProtectedHeader({ alg: GUEST_TOKEN_ALG, typ: GUEST_TOKEN_TYPE, kid: cfg.key.kid })
        .setIssuer(cfg.issuer)
        .setAudience(serverUrl(cfg.mcpBaseUrl, server))
        .setSubject(ctx.spaceId)
        .setIssuedAt(iat)
        .setExpirationTime(iat + GUEST_TOKEN_TTL_SECONDS)
        .sign(cfg.key.privateKey);
      return [server, token] as const;
    }),
  );
  return Object.fromEntries(entries) as TurnTokens;
}

/** Resolves the space's situation and mints its turn tokens; null when the space is gone. */
export async function mintTurnTokens(
  cfg: TokenConfig,
  db: Db,
  spaceId: string,
  now: Date,
): Promise<TurnTokens | null> {
  const ctx = await loadSituation(db, spaceId, now);
  return ctx ? mintServerTokens(cfg, ctx, now) : null;
}
