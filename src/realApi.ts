// Client for the REAL backend (backend/). Everything returned here comes from the running services / pipeline,
// not from the browser simulation engine.
const KEY = 'traceflow.apiBase';
// Dev server (vite, :5173) talks to the backend on :4000. When the backend serves the built UI itself, the API is same-origin ('').
export const DEFAULT_API = (import.meta.env.VITE_API_URL as string | undefined) ?? (import.meta.env.DEV ? 'http://localhost:4000' : '');

export const getApiBase = (): string => { try { return localStorage.getItem(KEY) || DEFAULT_API; } catch { return DEFAULT_API; } };
export const setApiBase = (v: string) => { try { localStorage.setItem(KEY, v.replace(/\/+$/, '')); } catch { /* storage disabled */ } };

export interface RealSpan { service: string; spanId: string; parentSpanId: string | null; kind: 'SERVER' | 'CLIENT'; name: string; startMs: number; durationMs: number; status: 'ok' | 'error'; error?: string; origin?: boolean }
export interface RealRequest { index: number; traceId: string | null; status: 'ok' | 'error'; httpStatus: number; durationMs: number; failedService: string | null; error: string | null; spanCount: number; spans?: RealSpan[] }
export interface SimulateResponse { runId: string; summary: { requested: number; ok: number; failed: number; durationMs: number; avgLatencyMs: number; p95LatencyMs: number; spansEmitted: number }; requests: RealRequest[] }
export interface SimulateParams { count: number; concurrency: number; errorRate: number; slowRate: number; failService: 'A' | 'B' | 'C' | null; includeSpans: boolean }
export interface Health { status: 'ok' | 'degraded' | 'shutting_down'; uptimeSeconds: number; services: Record<'A' | 'B' | 'C', 'up' | 'down'>; otlpEndpoint: string }
export interface BackendConfig { dashboardsUrl: string; s3Configured: boolean; s3Bucket: string | null; s3Prefix: string; s3Region: string | null; cloudwatchEnabled: boolean; cloudwatchNamespace: string; awsRegion: string | null; pipelineSettleMs: number }
export interface HistoryPoint { t: number; requests: number; ok: number; failed: number; rps: number; errorRate: number; avgLatencyMs: number; p95LatencyMs: number; sdkGenerated?: number; sdkExported?: number; collectorReceived?: number | null; collectorExported?: number | null; indexedSpans?: number | null }
export interface FaultState { errorRate: number; extraLatencyMs: number }
export interface FaultsResponse { faults: Record<'A' | 'B' | 'C', FaultState>; services: Record<'A' | 'B' | 'C', 'up' | 'down'> }
export interface S3Object { key: string; size: number; lastModified: string; storageClass?: string }
export interface CwStatus { enabled: boolean; namespace: string; region: string | null; intervalSec: number; environment: string; alarmName: string; lastPublishAt: string | null; lastError: string | null; publishedBatches: number; lastMetrics: Record<string, number> | null }
export interface CwSeries { namespace: string; periodSec: number; minutes: number; series: Record<string, { t: number; v: number }[]> }
export interface CwAlarm { name: string; state: string; reason?: string; metric?: string; threshold?: number; comparison?: string; updatedAt?: string }
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
  history: (minutes = 15) => call<{ intervalMs: number; points: HistoryPoint[] }>(`/metrics/history?minutes=${minutes}`, { timeoutMs: 8000 }),
  faults: () => call<FaultsResponse>('/faults', { timeoutMs: 5000 }),
  setFault: (service: string, f: Partial<FaultState>) => post<unknown>('/faults', { service, ...f }),
  resetFaults: () => call<unknown>('/faults', { method: 'DELETE' }),
  s3Objects: () => call<{ objects: S3Object[] }>('/archive/objects', { timeoutMs: 15000 }),
  cwStatus: () => call<CwStatus>('/cloudwatch/status', { timeoutMs: 5000 }),
  cwPublish: () => post<{ published?: number; at?: string; skipped?: boolean }>('/cloudwatch/publish', {}, 30000),
  cwMetrics: (minutes = 30) => call<CwSeries>(`/cloudwatch/metrics?minutes=${minutes}`, { timeoutMs: 30000 }),
  cwAlarms: () => call<{ alarms: CwAlarm[] }>('/cloudwatch/alarms', { timeoutMs: 20000 }),
  cwCreateAlarm: () => post<{ created: string; thresholdPct: number }>('/cloudwatch/alarms', {}, 20000),
};
