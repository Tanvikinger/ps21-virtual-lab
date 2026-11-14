import type { Config } from './types';

export const DEFAULT_CONFIG: Config = {
  traffic: { seed: 42, totalRequests: 200, arrivalRate: 20, concurrency: 50, baseLatencyMs: 40, errorProb: 0.03, slowProb: 0.1, slowMultiplier: 8 },
  services: { A: { latencyFactor: 1, errorProb: 0, available: true }, B: { latencyFactor: 1, errorProb: 0, available: true }, C: { latencyFactor: 1, errorProb: 0, available: true } },
  collector: { msPerTrace: 2, backlogLimit: 200 },
  sampling: { retainErrors: true, retainSlow: true, slowThresholdMs: 250, ordinaryPct: 20, waitMs: 300, maxPending: 500 },
  batch: { size: 20, timeoutMs: 500, exportDelayMs: 30, perRecordMs: 1, queueCapacity: 500, maxRetries: 3 },
  storage: { exporterAvailable: true, indexDelayMs: 40, indexAvailable: true, coldAvailable: true, archiveAfterMs: 2000, archiveIntervalMs: 1000 },
  faults: [],
};

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends any[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K] };

export function merge<T>(base: T, patch: DeepPartial<T>): T {
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...(base as any) };
  for (const k of Object.keys(patch as object)) {
    const pv = (patch as any)[k];
    const bv = (base as any)[k];
    out[k] = pv && typeof pv === 'object' && !Array.isArray(pv) && bv && typeof bv === 'object' ? merge(bv, pv) : pv;
  }
  return out;
}
export const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export const PRESETS: Record<string, { label: string; desc: string; patch: DeepPartial<Config> }> = {
  normal: { label: 'Normal Traffic', desc: '20 req/s, few errors, few slow requests.', patch: {} },
  high: { label: 'High Traffic', desc: '120 req/s from 600 requests; collector gets busy.', patch: { traffic: { arrivalRate: 120, totalRequests: 600 }, collector: { msPerTrace: 7 } } },
  errors: { label: 'Error Spike', desc: '25% error probability per service call.', patch: { traffic: { errorProb: 0.25 } } },
  slow: { label: 'Slow Service', desc: '40% of requests contain one very slow span.', patch: { traffic: { slowProb: 0.4, slowMultiplier: 12 } } },
  mixed: { label: 'Mixed Workload', desc: '8% errors and 20% slow requests.', patch: { traffic: { errorProb: 0.08, slowProb: 0.2 } } },
};

/** Returns human-readable validation problems (empty array = valid). */
export function validateConfig(c: Config): string[] {
  const e: string[] = [];
  const t = c.traffic;
  if (!(t.totalRequests >= 1 && t.totalRequests <= 5000)) e.push('Total requests must be between 1 and 5000.');
  if (!(t.arrivalRate > 0 && t.arrivalRate <= 1000)) e.push('Arrival rate must be between 1 and 1000 requests/second.');
  if (!(t.concurrency >= 1 && t.concurrency <= 1000)) e.push('Concurrency must be between 1 and 1000.');
  if (!(t.baseLatencyMs >= 1 && t.baseLatencyMs <= 2000)) e.push('Base latency must be between 1 and 2000 ms.');
  for (const [n, v] of [['Error probability', t.errorProb], ['Slow-request probability', t.slowProb]] as const)
    if (!(v >= 0 && v <= 1)) e.push(`${n} must be between 0 and 1 (e.g. 0.05 = 5%).`);
  if (!(t.slowMultiplier >= 1 && t.slowMultiplier <= 100)) e.push('Slow multiplier must be between 1 and 100.');
  if (!Number.isInteger(t.seed)) e.push('Seed must be a whole number.');
  const s = c.sampling;
  if (!(s.ordinaryPct >= 0 && s.ordinaryPct <= 100)) e.push('Ordinary-trace retention must be 0-100%.');
  if (!(s.waitMs >= 0)) e.push('Sampling wait time cannot be negative.');
  if (!(s.maxPending >= 1)) e.push('Max pending traces must be at least 1.');
  if (!(c.batch.size >= 1)) e.push('Batch size must be at least 1.');
  if (!(c.batch.timeoutMs >= 1)) e.push('Batch timeout must be at least 1 ms.');
  if (!(c.batch.queueCapacity >= 1)) e.push('Queue capacity must be at least 1.');
  if (!(c.collector.msPerTrace >= 0.1)) e.push('Collector time per trace must be at least 0.1 ms.');
  return e;
}
