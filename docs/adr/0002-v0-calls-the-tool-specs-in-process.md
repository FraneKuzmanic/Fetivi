# 0002: V0 calls the MCP servers' tool specs in process, not the domain package directly

**Status:** accepted, 2026-10-21 (ticket 18 review)

## Context

The architecture says V0 is the chat backend "calling the domain package in-process" with "the same tool definitions". The tool definitions (names, descriptions, schemas, annotations, `_meta`), the per-call scope and ownership checks, the input validation and `create_order`'s two halves live in `apps/mcp-servers`, not in `@fetivi/domain`. If V0 called the domain package itself, the chat backend would need its own copy of all of that, and every tool change would have to be made twice and kept equal by hand. V0 and V1 must differ by the MCP hop only, or the thesis measures something else.

## Decision

The guest tools are plain specs in `apps/mcp-servers/src/servers/*/tools.ts`, published as `@fetivi/mcp-servers/tools`. The MCP servers register from them; with `TOOL_TRANSPORT=inprocess` the chat backend lists and calls the same specs in its own process (`apps/chat-backend/src/tools/inprocess.ts`), with identity from `guestIdentityFor` instead of a token. `@fetivi/mcp-servers` is therefore a runtime dependency of the chat backend. The entry imports no server boot or HTTP code.

V0's second half of `create_order` is reached through the existing `POST /api/chat { answer }`, not a separate pending-record endpoint: the same stored message carries `requestState` in both modes.

## Consequences

- Both modes share one definition, one set of checks and one completion rule; `registry.int.test.ts` asserts equal `tools/list` output, refusals and pending records.
- Where V0 imitates the SDK (input-error wording, tool-error shape, `tools/list` schema conversion, "not found" mapping to the expiry refusal), an SDK upgrade can make the modes drift. The parity tests are the guard.
- The chat backend deploys with the MCP servers' code even in V1, where it does not run it. `TOOL_TRANSPORT=inprocess` is refused in production.
