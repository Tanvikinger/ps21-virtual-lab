export type ServiceId = 'A' | 'B' | 'C';
export type FaultKind =
  | 'service_down' | 'service_latency' | 'service_errors'
  | 'collector_slow' | 'queue_saturation' | 'exporter_down' | 'index_down' | 'cold_down';

export interface FaultSpec { kind: FaultKind; target?: ServiceId; startMs: number; endMs: number | null; magnitude?: number }
export interface Fault extends FaultSpec { id: number }

export interface Config {
  traffic: { seed: number; totalRequests: number; arrivalRate: number; concurrency: number; baseLatencyMs: number; errorProb: number; slowProb: number; slowMultiplier: number };
  services: Record<ServiceId, { latencyFactor: number; errorProb: number; available: boolean }>;
  collector: { msPerTrace: number; backlogLimit: number };
  sampling: { retainErrors: boolean; retainSlow: boolean; slowThresholdMs: number; ordinaryPct: number; waitMs: number; maxPending: number };
  batch: { size: number; timeoutMs: number; exportDelayMs: number; perRecordMs: number; queueCapacity: number; maxRetries: number };
  storage: { exporterAvailable: boolean; indexDelayMs: number; indexAvailable: boolean; coldAvailable: boolean; archiveAfterMs: number; archiveIntervalMs: number };
  faults: FaultSpec[];
}

export interface SpanRec {
  id: string; traceId: string; parentId: string | null; service: ServiceId; name: string;
  startMs: number; endMs: number; status: 'ok' | 'error'; error?: string; origin?: boolean;
}

export type SamplingState = 'none' | 'pending' | 'retained' | 'dropped' | 'incomplete' | 'lost';
export type ExportState = 'none' | 'queued' | 'exported' | 'failed' | 'dropped';
export type IndexState = 'none' | 'pending' | 'indexed' | 'failed';
export type ArchiveState = 'none' | 'pending' | 'archived';

export interface Trace {
  id: string; idx: number; startMs: number; endMs: number | null; durationMs: number | null;
  status: 'processing' | 'success' | 'error'; slow: boolean; spans: SpanRec[]; services: ServiceId[];
  sampling: { state: SamplingState; code?: 'error' | 'slow' | 'ordinary'; reason: string };
  export: ExportState; exportNote?: string; index: IndexState; archive: ArchiveState;
  enqueuedAt?: number; exportedAt?: number; indexedAt?: number; archivedAt?: number;
}

export interface SimEvent { t: number; level: 'info' | 'warn' | 'error'; type: string; msg: string }
export interface SeriesPoint { t: number; throughput: number; avgLatency: number; errorRate: number; queueDepth: number; collectorBacklog: number }
export interface BatchInfo { id: number; size: number; reason: 'size' | 'timeout'; at: number }
export interface ArchiveObject { id: string; at: number; count: number; traceIds: string[] }

export interface Summary {
  generated: number; waiting: number; processing: number; completed: number; failed: number; finished: number;
  throughput: number; avgLatency: number; p95Latency: number; errorRate: number;
  traces: number; spans: number;
  evaluated: number; retained: number; dropped: number; incomplete: number; lost: number; pendingSampling: number;
  errorRetained: number; slowRetained: number; ordinaryRetained: number; retentionPct: number;
  batches: number; avgBatch: number; queueNow: number; maxQueue: number; avgWaitMs: number;
  exported: number; exportFailed: number; queueDropped: number; exportSuccessRate: number; exportThroughput: number; exportRetries: number;
  indexed: number; indexPending: number; indexFailed: number; peakIndexPending: number;
  archivedObjects: number; archivedTraces: number; archivePending: number; archiveFailures: number; peakArchivePending: number;
  virtualTimeMs: number; done: boolean;
}
