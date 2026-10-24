# 0024: Caddy serves the SPAs, and internal hops use the public names

**Status:** accepted, 2026-10-24 (ticket 47)

## Context

Architecture §4.1 puts the guest app, the back office, the MCP servers and the MCP Apps sandbox on four origins (`app.`, `host.`, `mcp.`, `sandbox.`). Two hops stay inside the server: the chat backend calls the MCP servers, and the MCP servers fetch the chat backend's JWKS. The egress wrapper allows plain `http:` only for localhost. A guest token's audience is the MCP server's public URL, and the MCP servers accept only `Host: mcp.<domain>` (`allowedHosts`).

## Decision

- **Caddy serves both built SPAs** from its own image (`file_server` with an `index.html` fallback) next to the API routes of the same origin. Neither Node app serves static files.
- **Inside Compose the four public names are network aliases of Caddy.** The chat backend calls `https://mcp.<domain>` and the MCP servers fetch `https://app.<domain>/.well-known/jwks.json` through Caddy, the same URLs outside callers use.
- Caddy has a fixed IP, so `TRUST_PROXY` names exactly one proxy.

## Rejected

- Direct `http://chat-backend:3000` / `http://mcp-servers:3002` hops: blocked by the egress rule, and they would need a second set of URLs while the token audience still has to be the public one.
- Static serving inside the Node apps: two more code paths for something Caddy already does.

## Consequences

- No app code or config schema changed for production. One extra TLS hop on the box, which also exercises the real `allowedHosts` path.
- Locally (`*.localhost`), Caddy's internal CA has to be trusted by the Node containers (`NODE_EXTRA_CA_CERTS`, rehearsal overlay).
- The guest SPA's sandbox URL is a build argument, so changing the domain means rebuilding the Caddy image.
