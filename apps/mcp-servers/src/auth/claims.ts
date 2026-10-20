import type { GuestIdentity } from '@fetivi/domain';
import type { AuthInfo } from '@modelcontextprotocol/server';

/**
 * The caller's identity, from the verified token only. The bearer gate guarantees it; the throw
 * is the safety net should a server ever be mounted without the gate.
 */
export function identityFrom(authInfo: AuthInfo | undefined): GuestIdentity {
  const identity = authInfo?.extra?.identity as GuestIdentity | undefined;
  if (!identity) throw new Error('request reached a guest server without a verified token');
  return identity;
}
