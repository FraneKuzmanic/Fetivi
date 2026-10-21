import type { GuestIdentity } from '@fetivi/domain';
import {
  answerCreateOrder,
  createOrderSpec,
  type OrderAnswer,
  orderCodec,
  runGuestTool,
  type ToolDeps,
} from '@fetivi/mcp-servers/tools';

type ToolResult = Awaited<ReturnType<typeof runGuestTool>>;

/**
 * V0's second half of a guest-confirmed tool (architecture §4.3): the guest's tap reaches the
 * pending record through the app instead of elicitation. The rule is the services server's own:
 * the sealed state (HMAC, bound to create_order and this space, TTL) is checked here as the MCP
 * seam checks it; the record's owner, its TTL and consumed-once run in answerCreateOrder and
 * completeOrder. A state that fails the check answers 'expired', as the MCP path's -32602 does.
 * Never log `requestState` or the answer.
 */
export async function answerPending(
  deps: ToolDeps,
  identity: GuestIdentity,
  input: { requestState: string; answer: OrderAnswer },
): Promise<ToolResult | 'expired'> {
  const codec = orderCodec(deps.requestStateSecret, identity.spaceId);
  let pendingId: string;
  try {
    ({ pendingId } = await codec.verify(input.requestState));
  } catch {
    return 'expired';
  }
  // The scope is checked on this half too, as registerGuestConfirmTool does.
  return runGuestTool(identity, createOrderSpec.config, () =>
    answerCreateOrder(deps, identity, codec, pendingId, input.answer),
  );
}
