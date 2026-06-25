const BASE_URL = '/api';

interface RequestOptions {
  method: string;
  headers: {
    'Content-Type': string;
  };
  body?: string;
}

async function request<T = unknown>(method: string, path: string, body: unknown = null): Promise<T> {
  const options: RequestOptions = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) options.body = JSON.stringify(body);
  
  const response = await fetch(`${BASE_URL}${path}`, options);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || 'Request failed');
  }
  return response.json();
}

interface MenuItem {
  id?: number;
  name: string;
  price: number;
  category: string;
  [key: string]: unknown;
}

interface Order {
  id?: number;
  items: unknown[];
  total: number;
  [key: string]: unknown;
}

interface Staff {
  id: number;
  name: string;
  role: string;
  pin?: string;
  color?: string;
  active?: number;
  [key: string]: unknown;
}

interface Settings {
  restaurant_name?: string;
  [key: string]: unknown;
}

interface ReportParams {
  startDate?: string;
  endDate?: string;
  [key: string]: unknown;
}

export const menuAPI = {
  getAll: () => request<MenuItem[]>('GET', '/menu'),
  create: (item: MenuItem) => request<MenuItem>('POST', '/menu', item),
  update: (id: number, item: MenuItem) => request<MenuItem>(`PUT`, `/menu/${id}`, item),
  delete: (id: number) => request<void>('DELETE', `/menu/${id}`),
};

export const ordersAPI = {
  create: (order: Order) => request<Order>('POST', '/orders', order),
  getAll: (params: Record<string, string> = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request<Order[]>(`GET`, `/orders${qs ? `?${qs}` : ''}`);
  },
  getOne: (id: number) => request<Order>('GET', `/orders/${id}`),
  void: (id: number) => request<Order>('PUT', `/orders/${id}/void`),
};

export const reportsAPI = {
  kpi: (params: ReportParams) => request<Record<string, unknown>>('GET', `/reports/kpi?${new URLSearchParams(params as Record<string, string>).toString()}`),
  revenueOverTime: (params: ReportParams) => request<Record<string, unknown>>('GET', `/reports/revenue-over-time?${new URLSearchParams(params as Record<string, string>).toString()}`),
  topItems: (params: ReportParams) => request<Record<string, unknown>>('GET', `/reports/top-items?${new URLSearchParams(params as Record<string, string>).toString()}`),
  byCategory: (params: ReportParams) => request<Record<string, unknown>>('GET', `/reports/by-category?${new URLSearchParams(params as Record<string, string>).toString()}`),
  hourlyHeatmap: (params: ReportParams) => request<Record<string, unknown>>('GET', `/reports/hourly-heatmap?${new URLSearchParams(params as Record<string, string>).toString()}`),
  cashierPerformance: (params: ReportParams) => request<Record<string, unknown>>('GET', `/reports/cashier-performance?${new URLSearchParams(params as Record<string, string>).toString()}`),
  detailed: (params: ReportParams) => request<Record<string, unknown>>('GET', `/reports/detailed?${new URLSearchParams(params as Record<string, string>).toString()}`),
};

export const settingsAPI = {
  getAll: () => request<Settings>('GET', '/settings'),
  update: (data: Settings) => request<Settings>('PUT', '/settings', data),
  backup: async () => {
    const response = await fetch(`${BASE_URL}/backup`);
    if (!response.ok) throw new Error('Backup failed');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pos_backup_${new Date().toISOString().split('T')[0]}.db`;
    a.click();
    URL.revokeObjectURL(url);
  },
};

export const staffAPI = {
  getAll: () => request<Staff[]>('GET', '/staff'),
  create: (data: Staff) => request<Staff>('POST', '/staff', data),
  update: (id: number, data: Staff) => request<Staff>('PUT', `/staff/${id}`, data),
  delete: (id: number) => request<void>('DELETE', `/staff/${id}`),
  login: (pin: string, staffId: number) => request<Staff>('POST', '/staff/login', { pin, staff_id: staffId }),
  performance: (params: Record<string, string> = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request<Record<string, unknown>>('GET', `/staff/performance${qs ? `?${qs}` : ''}`);
  },
};
