/**
 * Cloud API client.
 *
 * Same-origin: the cloud serves this build in production, and Vite proxies
 * `/api` across in development. So there is no base URL to configure and no
 * CORS to negotiate — which also means the session cookie needs no
 * `SameSite=None`, and is never readable by this code.
 *
 * `credentials: 'include'` is what carries that cookie. It is httpOnly, so the
 * only evidence here that anyone is signed in is whether a request succeeds.
 */

const BASE = '/api';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || 'Request failed', res.status);
  return data;
}

export const auth = {
  login: (email, password) => request('POST', '/auth/login', { email, password }),
  logout: () => request('POST', '/auth/logout'),
  me: () => request('GET', '/auth/me'),
};

export const live = {
  read: () => request('GET', '/live'),
};
