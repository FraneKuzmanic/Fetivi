export class ApiError extends Error {
  override name = 'ApiError';
  constructor(
    readonly status: number,
    readonly code: string,
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
  const json = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new ApiError(response.status, json?.error ?? 'internal');
  return json as T;
}

export interface Me {
  account: { id: string; email: string; role: 'host' | 'admin' };
  actingAs: { id: string; email: string } | null;
}

export interface HostSummary {
  id: string;
  email: string;
  emailVerified: boolean;
  suspended: boolean;
  createdAt: string;
}

export interface AuditEntry {
  id: number;
  adminId: string;
  hostId: string;
  hostEmail: string;
  method: string;
  route: string;
  statusCode: number | null;
  createdAt: string;
}

const post = <T = void>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body });

export const auth = {
  me: () => api<Me>('/api/auth/me'),
  login: (email: string, password: string) => post<Me>('/api/auth/login', { email, password }),
  logout: () => post('/api/auth/logout'),
  signUp: (email: string, password: string) => post('/api/auth/sign-up', { email, password }),
  verifyEmail: (token: string) => post('/api/auth/verify-email', { token }),
  resendVerification: (email: string) => post('/api/auth/resend-verification', { email }),
  requestReset: (email: string) => post('/api/auth/password-reset/request', { email }),
  confirmReset: (token: string, password: string) =>
    post('/api/auth/password-reset/confirm', { token, password }),
};

export const admin = {
  hosts: () => api<{ hosts: HostSummary[] }>('/api/admin/hosts'),
  suspend: (id: string) => post(`/api/admin/hosts/${id}/suspend`),
  unsuspend: (id: string) => post(`/api/admin/hosts/${id}/unsuspend`),
  remove: (id: string) => api<void>(`/api/admin/hosts/${id}`, { method: 'DELETE' }),
  actAs: (hostId: string) => post<Me>('/api/admin/act-as', { hostId }),
  stopActing: () => post<Me>('/api/admin/act-as/stop'),
  audit: () => api<{ entries: AuditEntry[] }>('/api/admin/audit'),
};
