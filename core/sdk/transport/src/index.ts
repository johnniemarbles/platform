export interface Transport {
  request<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T>;
}

export class PlatformApiError extends Error {
  readonly code: string;
  readonly traceId: string;

  constructor(code: string, traceId: string, message?: string) {
    super(message ?? code);
    this.name = 'PlatformApiError';
    this.code = code;
    this.traceId = traceId;
  }
}

export function buildQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}
