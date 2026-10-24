import type { GuestLanguage } from '@fetivi/domain/vocabulary';

export class ApiError extends Error {
  override name = 'ApiError';
  constructor(
    readonly status: number,
    readonly code: string,
    /** Seconds until the next PIN attempt is checked, on wrong-pin and too-many-attempts. */
    readonly retryAfter?: number,
  ) {
    super(code);
  }
}

export async function api<T>(
  path: string,
  { method = 'GET', body }: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (response.status === 204) return undefined as T;
  const json = (await response.json().catch(() => null)) as {
    error?: string;
    retryAfter?: number;
  } | null;
  if (!response.ok) {
    throw new ApiError(response.status, json?.error ?? 'internal', json?.retryAfter);
  }
  return json as T;
}

/** The guest's space as the server reports it. No names, no unit or property details. */
export interface Space {
  language: GuestLanguage;
  closedAt: string;
  closed: boolean;
  unitSlug: string;
  /** The guest opted to keep the conversation for the thesis evaluation. Off by default. */
  keepForEvaluation: boolean;
}

const path = (slug: string) => `/api/access/${encodeURIComponent(slug)}`;

/** Resolves when the unit link works; ApiError 404 when it does not. */
export const checkLink = (slug: string) => api<void>(path(slug));

export const enterPin = (slug: string, pin: string, language: GuestLanguage) =>
  api<Space>(`${path(slug)}/pin`, { method: 'POST', body: { pin, language } });

export const getSpace = () => api<Space>('/api/space');

export const setSpaceLanguage = (language: GuestLanguage) =>
  api<Space>('/api/space', { method: 'PATCH', body: { language } });

export const setKeepForEvaluation = (keepForEvaluation: boolean) =>
  api<Space>('/api/space', { method: 'PATCH', body: { keepForEvaluation } });
