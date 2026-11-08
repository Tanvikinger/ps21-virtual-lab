// Client for the REAL backend (backend/). Everything returned here comes from the running services / pipeline,
// not from the browser simulation engine.
const KEY = 'ps21.apiBase';
export const DEFAULT_API = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000';

export const getApiBase = (): string => { try { return localStorage.getItem(KEY) || DEFAULT_API; } catch { return DEFAULT_API; } };
export const setApiBase = (v: string) => { try { localStorage.setItem(KEY, v.replace(/\/+$/, '')); } catch { /* storage disabled */ } };

export interface RealSpan { service: string; spanId: string; parentSpanId: string | null; kind: 'SERVER' | 'CLIENT'; name: string; startMs: number; durationMs: number; status: 'ok' | 'error'; error?: string; origin?: boolean }
export interface RealRequest { index: number; traceId: string | null; status: 'ok' | 'error'; httpStatus: number; durationMs: number; failedService: string | null; error: string | null; spanCount: number; spans?: RealSpan[] }
export interface SimulateResponse { runId: string; summary: { requested: number; ok: number; failed: number; durationMs: number; avgLatencyMs: number; p95LatencyMs: number; spansEmitted: number }; requests: RealRequest[] }
export interface SimulateParams { count: number; concurrency: number; errorRate: number; slowRate: number; failService: 'A' | 'B' | 'C' | null; includeSpans: boolean }
export interface Health { status: 'ok' | 'degraded' | 'shutting_down'; uptimeSeconds: number; services: Record<'A' | 'B' | 'C', 'up' | 'down'>; otlpEndpoint: string }
export interface BackendConfig { dashboardsUrl: string; s3Configured: boolean; s3Bucket: string | null; s3Prefix: string; pipelineSettleMs: number }
export interface TraceStatus { traceId: string; state: 'indexed' | 'pending' | 'not_indexed' | 'unknown'; spanCount?: number; services?: string[]; hasError?: boolean; inferred?: boolean; note?: string; error?: string }
export interface PolicyCount { sampled: number; notSampled: number }
export interface PipelineMetrics {
  sdk: { generated: Record<string, number>; generatedTotal: number; exportedSpans: number; failedSpans: number; exportOk: number; exportFailed: number; lastError: string | null };
  requests: { requests: number; ok: number; failed: number; runs: number };
  collector: { receivedSpans: number; refusedSpans: number; exportedSpans: number; exportFailedSpans: number; spansNotExported: number; tailSampling: { tracesEvaluated: number; droppedTooEarly: number; byPolicy: Record<string, PolicyCount> }; batch: { sends: number; avgBatchSize: number; sizeTriggered: number; timeoutTriggered: number } } | null;
  collectorError?: string;
  opensearch: { reachable: boolean; clusterStatus?: string; error?: string; indexedSpans?: number; countError?: string } | null;
}
export interface ArchiveResult { status: 'archived' | 'verification_failed' | 'empty'; message?: string; verified?: boolean; bucket?: string; key?: string; bytesUploaded?: number; bytesUncompressed?: number; spanCount?: number; traceCount?: number; storageClass?: string; archivedAt?: string }

export class ApiError extends Error { constructor(message: string, public status?: number, public body?: unknown) { super(message); } }

async function call<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), init?.timeoutMs ?? 20000);
  try {
    const r = await fetch(getApiBase() + path, { ...init, signal: ctl.signal, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
    const body = await r.json().catch(() => null);
    if (!r.ok) throw new ApiError((body as { message?: string; error?: string } | null)?.message ?? (body as { error?: string } | null)?.error ?? `HTTP ${r.status}`, r.status, body);
    return body as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(e instanceof DOMException && e.name === 'AbortError' ? 'Request timed out' : 'Cannot reach the backend (is it running? is CORS_ORIGINS set for this site?)');
  } finally { clearTimeout(t); }
}
const post = <T,>(p: string, b?: unknown, timeoutMs?: number) => call<T>(p, { method: 'POST', body: JSON.stringify(b ?? {}), timeoutMs });

export const api = {
  health: () => call<Health>('/health', { timeoutMs: 4000 }),
  config: () => call<BackendConfig>('/config', { timeoutMs: 4000 }),
  simulate: (p: SimulateParams) => post<SimulateResponse>('/simulate', p, 120000),
  traceStatus: (id: string) => call<TraceStatus>(`/telemetry/trace/${id}`, { timeoutMs: 10000 }),
  metrics: () => call<PipelineMetrics>('/pipeline/metrics', { timeoutMs: 10000 }),
  crash: (s: string) => post<unknown>(`/faults/${s}/crash`),
  recover: (s: string) => post<unknown>(`/faults/${s}/recover`),
  archive: (sinceMinutes: number) => post<ArchiveResult>('/archive', { sinceMinutes }, 60000),
};
