/**
 * The POS screens' API client, pointed at the cloud.
 *
 * Aliased over `@/api/index` in vite.config.js, so `frontend/src` is reused
 * completely unmodified — the screens keep importing `@/api/index` and get this
 * instead. Two things differ from the till's version, and nothing else:
 *
 *   - **Same-origin `/api`** rather than `http://localhost:3001/api`. The cloud
 *     serves this build, so there is no base URL to configure and no CORS.
 *   - **A session cookie** rather than a Bearer token. It is httpOnly, so this
 *     code cannot read it; `credentials: 'include'` is what carries it.
 *
 * **Writes are refused, deliberately.** Expenses, shifts, staff and stock
 * belong to the branch that records them, and there is no downlink for any of
 * them — sales travel up, and only the menu comes down. A write here could not
 * reach a till that was offline, which is exactly when someone would try. An
 * explicit refusal is better than a button that appears to work.
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

const qs = (params = {}) => {
  const clean = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v != null && v !== '')
  );
  const s = new URLSearchParams(clean).toString();
  return s ? `?${s}` : '';
};

/**
 * Refuse a write, with a message that says where the thing actually lives.
 *
 * Thrown rather than silently ignored: the screens already surface a failed
 * call, so the person sees why instead of wondering whether it saved.
 */
const readOnly = (what) => () => {
  throw new ApiError(
    `${what} is recorded at the branch, on the till. The dashboard shows it but cannot change it.`,
    403
  );
};

/* ------------------------------------------------------------- reports -- */

export const reportsAPI = {
  kpi: (p) => request('GET', `/reports/kpi${qs(p)}`),
  revenueOverTime: (p) => request('GET', `/reports/revenue-over-time${qs(p)}`),
  topItems: (p) => request('GET', `/reports/top-items${qs(p)}`),
  byCategory: (p) => request('GET', `/reports/by-category${qs(p)}`),
  hourlyHeatmap: (p) => request('GET', `/reports/hourly-heatmap${qs(p)}`),
  cashierPerformance: (p) => request('GET', `/reports/cashier-performance${qs(p)}`),
  detailed: (p) => request('GET', `/reports/detailed${qs(p)}`),
  lineItems: (p) => request('GET', `/reports/line-items${qs(p)}`),
  expensesByCategory: (p) => request('GET', `/reports/expenses-by-category${qs(p)}`),
  expensesDetail: (p) => request('GET', `/reports/expenses-detail${qs(p)}`),
  daily: (p) => request('GET', `/reports/daily${qs(p)}`),
};

export const branchesAPI = {
  getAll: () => request('GET', '/branches'),
  completeness: () => request('GET', '/branches/completeness'),
};

export const liveAPI = {
  read: () => request('GET', '/live'),
};

/* -------------------------------------------------- branch-owned, read-only */

export const expensesAPI = {
  list: (params = {}) => request('GET', `/expenses${qs(params)}`),
  categories: () => request('GET', '/expenses/categories'),
  create: readOnly('An expense'),
  remove: readOnly('An expense'),
};

export const shiftsAPI = {
  current: () => request('GET', '/shifts/current'),
  history: (limit = 10) => request('GET', `/shifts/history?limit=${limit}`),
  open: readOnly('A shift'),
  close: readOnly('A shift'),
  summary: (id) => request('GET', `/shifts/${id}/summary`),
};

export const staffAPI = {
  getAll: () => request('GET', '/staff'),
  performance: (params = {}) => request('GET', `/staff/performance${qs(params)}`),
  create: readOnly('A staff account'),
  update: readOnly('A staff account'),
  delete: readOnly('A staff account'),
  // Not the dashboard's login — that is email and password, in auth.js.
  login: readOnly('Signing in'),
  logout: () => request('POST', '/auth/logout'),
  me: () => request('GET', '/auth/me'),
};

export const inventoryAPI = {
  getAll: () => request('GET', '/inventory'),
  lowStock: () => request('GET', '/inventory').then(
    rows => rows.filter(r => Number(r.stock) <= Number(r.low_stock_threshold))),
  create: readOnly('Stock'),
  updateStock: readOnly('Stock'),
  updateThreshold: readOnly('Stock'),
  delete: readOnly('Stock'),
};

/* ------------------------------------------------------------------ menu -- */

/*
 * The menu is the one thing the cloud will own outright, and the one thing that
 * travels down to the tills. Until that is built these read from the cloud's
 * copy and refuse writes, so the screens render rather than erroring on load.
 */
export const menuAPI = {
  getAll: () => request('GET', '/menu'),
  create: readOnly('The menu'),
  update: readOnly('The menu'),
  delete: readOnly('The menu'),
};

export const dealsAPI = {
  getAll: () => request('GET', '/deals'),
  getOne: (id) => request('GET', `/deals/${id}`),
  create: readOnly('Deals'),
  update: readOnly('Deals'),
  delete: readOnly('Deals'),
};

export const ordersAPI = {
  getAll: (params = {}) => request('GET', `/reports/detailed${qs(params)}`),
  create: readOnly('An order'),
  void: readOnly('Voiding an order'),
};

export const settingsAPI = {
  getAll: () => request('GET', '/settings'),
  update: readOnly('Settings'),
};

export const syncAPI = {
  now: readOnly('Syncing'),
  status: () => request('GET', '/branches/completeness'),
};

// The till's module exports these for its own token plumbing; the dashboard has
// none, but the screens import from this module so the names must exist.
export const setAuthToken = () => {};
export const getAuthToken = () => null;
export const setUnauthorizedHandler = () => {};
