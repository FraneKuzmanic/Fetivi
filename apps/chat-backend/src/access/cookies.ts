import type { CookieSerializeOptions } from '@fastify/cookie';
import { DEVICE_COOKIE, newToken, SPACE_READ_ONLY_DAYS } from '@fetivi/domain';
import type { FastifyReply, FastifyRequest } from 'fastify';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEVICE_MAX_AGE_S = 400 * 24 * 60 * 60;

/** Browsers drop a `__Host-` cookie, even a clearing one, without Secure and Path=/. */
export const clearCookieOptions: CookieSerializeOptions = {
  path: '/',
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
};

/** Lives through the read-only period after closing; the server enforces closing itself. */
export function spaceCookieOptions(closedAt: Date, now: Date): CookieSerializeOptions {
  const until = closedAt.getTime() + SPACE_READ_ONLY_DAYS * DAY_MS;
  return { ...clearCookieOptions, maxAge: Math.max(0, Math.floor((until - now.getTime()) / 1000)) };
}

/** The device id the per-device PIN limit counts against; set on first contact. */
export function ensureDeviceId(request: FastifyRequest, reply: FastifyReply): string {
  const existing = request.cookies[DEVICE_COOKIE];
  if (existing) return existing;
  const id = newToken();
  reply.setCookie(DEVICE_COOKIE, id, { ...clearCookieOptions, maxAge: DEVICE_MAX_AGE_S });
  return id;
}
