import { accounts, sessions } from '@fetivi/domain';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cookieFrom,
  createTestApp,
  get,
  loginAs,
  PASSWORD,
  post,
  signUpVerifiedHost,
  type TestApp,
  tokenFrom,
} from '../testing';
import { SESSION_COOKIE } from './sessions';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
});

afterAll(async () => {
  await t?.close();
});

const mailsTo = (email: string) => t.mailer.sent.filter((m) => m.to === email);

describe('sign-up and verification', () => {
  it('sends a verify link and refuses login until verified', async () => {
    const signUp = await post(t.app, '/api/auth/sign-up', {
      email: 'new@example.test',
      password: PASSWORD,
    });
    expect(signUp.statusCode).toBe(202);
    expect(mailsTo('new@example.test')).toHaveLength(1);
    expect(mailsTo('new@example.test')[0]?.text).toContain('http://host.test/verify-email?token=');

    const login = await post(t.app, '/api/auth/login', {
      email: 'new@example.test',
      password: PASSWORD,
    });
    expect(login.statusCode).toBe(403);
    expect(login.json()).toEqual({ error: 'email-not-verified' });
  });

  it('verifies, then logs in with a __Host- session cookie', async () => {
    const verify = await post(t.app, '/api/auth/verify-email', { token: tokenFrom(t.mailer) });
    expect(verify.statusCode).toBe(200);

    const login = await post(t.app, '/api/auth/login', {
      email: 'new@example.test',
      password: PASSWORD,
    });
    expect(login.statusCode).toBe(200);
    const setCookie = String(login.headers['set-cookie']);
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).not.toContain('Domain');

    const me = await get(t.app, '/api/auth/me', cookieFrom(login));
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      account: { email: 'new@example.test', role: 'host' },
      actingAs: null,
    });
  });

  it('stores an argon2id hash and only the hash of the session token', async () => {
    const [account] = await t.db
      .select()
      .from(accounts)
      .where(eq(accounts.email, 'new@example.test'));
    expect(account?.passwordHash.startsWith('$argon2id$')).toBe(true);

    const cookie = await loginAs(t, 'new@example.test');
    const token = cookie.split('=')[1] ?? '';
    const rows = await t.db
      .select()
      .from(sessions)
      .where(eq(sessions.accountId, account?.id ?? ''));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.id)).not.toContain(token);
  });

  it('accepts an email with spaces and capitals as the same account', async () => {
    await signUpVerifiedHost(t, ' Mixed@Example.COM ');
    await expect(loginAs(t, 'mixed@example.com')).resolves.toContain(SESSION_COOKIE);
  });

  it('answers an existing verified email with a reset link and leaves the password alone', async () => {
    const response = await post(t.app, '/api/auth/sign-up', {
      email: 'new@example.test',
      password: 'some other password',
    });
    expect(response.statusCode).toBe(202);
    const last = mailsTo('new@example.test').at(-1);
    expect(last?.subject).toBe('You already have a Fetivi account');
    expect(last?.text).toContain('/reset-password?token=');
    await expect(loginAs(t, 'new@example.test')).resolves.toContain(SESSION_COOKIE);
  });

  it('rejects an expired or reused verify token', async () => {
    await post(t.app, '/api/auth/sign-up', { email: 'late@example.test', password: PASSWORD });
    const expired = tokenFrom(t.mailer);
    t.clock.advance(24 * HOUR + 1);
    const late = await post(t.app, '/api/auth/verify-email', { token: expired });
    expect(late.statusCode).toBe(400);
    expect(late.json()).toEqual({ error: 'invalid-token' });

    await post(t.app, '/api/auth/resend-verification', { email: 'late@example.test' });
    const fresh = tokenFrom(t.mailer);
    expect((await post(t.app, '/api/auth/verify-email', { token: fresh })).statusCode).toBe(200);
    expect((await post(t.app, '/api/auth/verify-email', { token: fresh })).statusCode).toBe(400);
  });

  it('sends at most 3 verification mails per hour', async () => {
    t.clock.advance(2 * HOUR);
    await post(t.app, '/api/auth/sign-up', { email: 'spam@example.test', password: PASSWORD });
    for (let i = 0; i < 5; i++) {
      const r = await post(t.app, '/api/auth/resend-verification', { email: 'spam@example.test' });
      expect(r.statusCode).toBe(202);
    }
    expect(mailsTo('spam@example.test')).toHaveLength(3);
  });

  it('rejects a weak password and a malformed body', async () => {
    const weak = await post(t.app, '/api/auth/sign-up', {
      email: 'w@example.test',
      password: 'short',
    });
    expect(weak.statusCode).toBe(400);
    expect(weak.json()).toEqual({ error: 'invalid-input' });
    const missing = await post(t.app, '/api/auth/sign-up');
    expect(missing.statusCode).toBe(400);
  });
});

describe('login', () => {
  it('gives the same answer for an unknown email and a wrong password', async () => {
    const unknown = await post(t.app, '/api/auth/login', {
      email: 'nobody@example.test',
      password: PASSWORD,
    });
    const wrong = await post(t.app, '/api/auth/login', {
      email: 'new@example.test',
      password: 'wrong password here',
    });
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.body).toBe(wrong.body);
    expect(unknown.json()).toEqual({ error: 'invalid-credentials' });
  });

  it('throttles after 5 failures and recovers after 15 minutes', async () => {
    await signUpVerifiedHost(t, 'throttle@example.test');
    const attempt = (password: string) =>
      post(t.app, '/api/auth/login', { email: 'throttle@example.test', password });
    for (let i = 0; i < 5; i++) expect((await attempt('wrong password')).statusCode).toBe(401);
    const blocked = await attempt(PASSWORD);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toEqual({ error: 'too-many-attempts' });

    t.clock.advance(15 * 60 * 1000 + 1);
    expect((await attempt(PASSWORD)).statusCode).toBe(200);
  });

  it('rotates the session when logging in with a session cookie', async () => {
    const first = await loginAs(t, 'new@example.test');
    const second = await post(
      t.app,
      '/api/auth/login',
      { email: 'new@example.test', password: PASSWORD },
      first,
    );
    expect(second.statusCode).toBe(200);
    expect((await get(t.app, '/api/auth/me', first)).statusCode).toBe(401);
    expect((await get(t.app, '/api/auth/me', cookieFrom(second))).statusCode).toBe(200);
  });

  it('logs out and refuses the cookie afterwards', async () => {
    const cookie = await loginAs(t, 'new@example.test');
    const logout = await post(t.app, '/api/auth/logout', undefined, cookie);
    expect(logout.statusCode).toBe(204);
    expect(String(logout.headers['set-cookie'])).toContain(`${SESSION_COOKIE}=;`);
    expect((await get(t.app, '/api/auth/me', cookie)).statusCode).toBe(401);
  });

  it('rejects writes without the back-office Origin', async () => {
    const body = { email: 'new@example.test', password: PASSWORD };
    const none = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: body });
    const evil = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: body,
      headers: { origin: 'http://evil.test' },
    });
    for (const response of [none, evil]) {
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'bad-origin' });
    }
  });
});

describe('password reset', () => {
  it('answers the same for an unknown email and sends nothing', async () => {
    const before = t.mailer.sent.length;
    const r = await post(t.app, '/api/auth/password-reset/request', {
      email: 'ghost@example.test',
    });
    expect(r.statusCode).toBe(202);
    expect(t.mailer.sent.length).toBe(before);
  });

  it('sets a new password, ends every session and is single-use', async () => {
    await signUpVerifiedHost(t, 'reset@example.test');
    const oldSession = await loginAs(t, 'reset@example.test');

    await post(t.app, '/api/auth/password-reset/request', { email: 'reset@example.test' });
    const token = tokenFrom(t.mailer);
    const confirm = await post(t.app, '/api/auth/password-reset/confirm', {
      token,
      password: 'a brand new password',
    });
    expect(confirm.statusCode).toBe(204);

    expect((await get(t.app, '/api/auth/me', oldSession)).statusCode).toBe(401);
    const old = await post(t.app, '/api/auth/login', {
      email: 'reset@example.test',
      password: PASSWORD,
    });
    expect(old.statusCode).toBe(401);
    await expect(loginAs(t, 'reset@example.test', 'a brand new password')).resolves.toContain(
      SESSION_COOKIE,
    );

    const reused = await post(t.app, '/api/auth/password-reset/confirm', {
      token,
      password: 'yet another password',
    });
    expect(reused.statusCode).toBe(400);
    expect(reused.json()).toEqual({ error: 'invalid-token' });
  });

  it('expires the reset link after 1 hour', async () => {
    await post(t.app, '/api/auth/password-reset/request', { email: 'reset@example.test' });
    const token = tokenFrom(t.mailer);
    t.clock.advance(HOUR + 1);
    const late = await post(t.app, '/api/auth/password-reset/confirm', {
      token,
      password: 'too late password',
    });
    expect(late.statusCode).toBe(400);
  });

  it('refuses a verify token on the reset endpoint', async () => {
    await post(t.app, '/api/auth/sign-up', { email: 'purpose@example.test', password: PASSWORD });
    const verifyToken = tokenFrom(t.mailer);
    const r = await post(t.app, '/api/auth/password-reset/confirm', {
      token: verifyToken,
      password: 'some new password',
    });
    expect(r.statusCode).toBe(400);
  });
});

describe('session expiry', () => {
  it('expires after 30 idle days, deletes the row and clears the cookie', async () => {
    const cookie = await loginAs(t, 'new@example.test');
    t.clock.advance(31 * DAY);
    const me = await get(t.app, '/api/auth/me', cookie);
    expect(me.statusCode).toBe(401);
    expect(String(me.headers['set-cookie'])).toContain(`${SESSION_COOKIE}=;`);
    const rows = await t.db.select().from(sessions);
    const token = cookie.split('=')[1] ?? '';
    expect(rows.some((r) => r.id === token)).toBe(false);
  });

  it('slides with activity but ends at the 90-day absolute limit', async () => {
    const cookie = await loginAs(t, 'new@example.test');
    for (let day = 20; day <= 80; day += 20) {
      t.clock.advance(20 * DAY);
      expect((await get(t.app, '/api/auth/me', cookie)).statusCode).toBe(200);
    }
    t.clock.advance(10 * DAY + 1);
    expect((await get(t.app, '/api/auth/me', cookie)).statusCode).toBe(401);
  });
});
