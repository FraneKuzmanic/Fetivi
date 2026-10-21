import type { GuestLanguage } from '@fetivi/domain';

export type Access = 'public' | 'authenticated' | 'host' | 'admin';
export type Role = 'host' | 'admin';

export interface Principal {
  sessionId: string;
  /** `language`: the person's back-office language, which the setup wizard follows. */
  account: { id: string; email: string; role: Role; language: GuestLanguage };
  actingAs: { id: string; email: string } | null;
}

export type AccessDecision =
  | { ok: true; hostId: string | null }
  | { ok: false; status: 401 | 403; code: 'unauthenticated' | 'forbidden' | 'stop-acting-first' };

/** The whole back-office authorisation policy: who may reach a route, and as which host. */
export function decideAccess(access: Access, principal: Principal | null): AccessDecision {
  if (access === 'public') return { ok: true, hostId: null };
  if (!principal) return { ok: false, status: 401, code: 'unauthenticated' };

  const { account, actingAs } = principal;
  const isAdmin = account.role === 'admin';

  switch (access) {
    case 'authenticated':
      return { ok: true, hostId: actingAs?.id ?? (isAdmin ? null : account.id) };
    case 'host':
      if (!isAdmin) return { ok: true, hostId: account.id };
      if (actingAs) return { ok: true, hostId: actingAs.id };
      return { ok: false, status: 403, code: 'forbidden' };
    case 'admin':
      if (!isAdmin) return { ok: false, status: 403, code: 'forbidden' };
      if (actingAs) return { ok: false, status: 403, code: 'stop-acting-first' };
      return { ok: true, hostId: null };
  }
}
