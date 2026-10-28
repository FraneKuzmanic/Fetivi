import { describe, expect, it } from 'vitest';
import { type Access, type AccessDecision, decideAccess, type Principal } from './access';

const host: Principal = {
  sessionId: 's1',
  account: {
    id: 'host-1',
    email: 'h@example.test',
    role: 'host',
    language: 'en',
    languageChosen: false,
  },
  actingAs: null,
};
const admin: Principal = {
  sessionId: 's2',
  account: {
    id: 'admin-1',
    email: 'a@example.test',
    role: 'admin',
    language: 'en',
    languageChosen: false,
  },
  actingAs: null,
};
const acting: Principal = { ...admin, actingAs: { id: 'host-2', email: 'h2@example.test' } };

const unauthenticated: AccessDecision = { ok: false, status: 401, code: 'unauthenticated' };
const forbidden: AccessDecision = { ok: false, status: 403, code: 'forbidden' };

const cases: [Access, string, Principal | null, AccessDecision][] = [
  ['public', 'nobody', null, { ok: true, hostId: null }],
  ['public', 'host', host, { ok: true, hostId: null }],
  ['public', 'admin', admin, { ok: true, hostId: null }],
  ['public', 'acting admin', acting, { ok: true, hostId: null }],
  ['authenticated', 'nobody', null, unauthenticated],
  ['authenticated', 'host', host, { ok: true, hostId: 'host-1' }],
  ['authenticated', 'admin', admin, { ok: true, hostId: null }],
  ['authenticated', 'acting admin', acting, { ok: true, hostId: 'host-2' }],
  ['host', 'nobody', null, unauthenticated],
  ['host', 'host', host, { ok: true, hostId: 'host-1' }],
  ['host', 'admin', admin, forbidden],
  ['host', 'acting admin', acting, { ok: true, hostId: 'host-2' }],
  ['admin', 'nobody', null, unauthenticated],
  ['admin', 'host', host, forbidden],
  ['admin', 'admin', admin, { ok: true, hostId: null }],
  ['admin', 'acting admin', acting, { ok: false, status: 403, code: 'stop-acting-first' }],
];

describe('decideAccess', () => {
  it.each(cases)('%s route, %s', (access, _who, principal, expected) => {
    expect(decideAccess(access, principal)).toEqual(expected);
  });
});
