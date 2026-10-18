export class ApiError extends Error {
  public status: number;
  public code: string;
  public current?: any;

  constructor(status: number, code: string, message: string, current?: any) {
    super(message);
    this.status = status;
    this.code = code;
    this.current = current;
    this.name = 'ApiError';
  }
}

const TOKEN_KEY = 'ops_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function removeToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export interface RequestOptions extends RequestInit {
  idempotencyKey?: string;
}

export async function apiFetch<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  const token = getToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  if (options.idempotencyKey) {
    headers.set('Idempotency-Key', options.idempotencyKey);
  }

  const normalizedPath = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = normalizedPath.startsWith('/api') ? normalizedPath : `/api${normalizedPath}`;

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    removeToken();
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
    throw new ApiError(401, 'UNAUTHENTICATED', 'Your session has expired. Please sign in again.');
  }

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const errorPayload = data?.error;
    throw new ApiError(
      response.status,
      errorPayload?.code || 'REQUEST_FAILED',
      errorPayload?.message || `Request failed with status ${response.status}`,
      errorPayload?.current
    );
  }

  return data as T;
}
