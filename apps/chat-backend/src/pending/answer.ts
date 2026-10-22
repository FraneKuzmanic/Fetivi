import type { GuestIdentity } from '@fetivi/domain';
import {
  type ConfirmAnswer,
  type ConfirmTool,
  runGuestTool,
  type ToolDeps,
} from '@fetivi/mcp-servers/tools';

type ToolResult = Awaited<ReturnType<typeof runGuestTool>>;

/**
 * V0's second half of a guest-confirmed tool (architecture §4.3): the guest's tap reaches the
 * pending record through the app instead of elicitation. The rule is the MCP server's own: the
 * sealed state (HMAC, bound to the tool and this space, TTL) is checked here as the MCP seam
 * checks it; the record's owner, its TTL and consumed-once run in the tool's halves. A state that
 * fails the check answers 'expired', as the MCP path's -32602 does.
 * Never log `requestState` or the answer.
 */
export async function answerPending(
  deps: ToolDeps,
  identity: GuestIdentity,
  tool: ConfirmTool,
  input: { requestState: string; answer: ConfirmAnswer },
): Promise<ToolResult | 'expired'> {
  const codec = tool.codec(deps.requestStateSecret, identity.spaceId);
  let pendingId: string;
  try {
    ({ pendingId } = await codec.verify(input.requestState));
  } catch {
    return 'expired';
  }
  // The scope is checked on this half too, as registerGuestConfirmTool does.
  return runGuestTool(
    identity,
    tool.spec.config,
    async () =>
      (await tool.answer(deps, identity, codec, pendingId, input.answer)) as Record<
        string,
        unknown
      >,
  );
}
