import type { Summary, ServiceId } from './types';
import type { Simulator } from './simulationEngine';

/** Nearest-rank percentile: sorted ascending, rank = ceil(p/100 * n), value = sorted[rank-1]. */
export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(sorted.length, rank) - 1];
}
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

/**
 * All values are derived from recorded trace/event state. Denominators:
 *  - avg/p95 latency, throughput, error rate: finished requests (success + failed)
 *  - retention %: retained / evaluated (evaluated = retained + dropped + incomplete; 'lost' traces never reached a decision)
 *  - export success rate: exported / (exported + failed + queue-dropped), counted in traces
 */
export function computeMetrics(sim: Simulator): Summary {
  const T = sim.traces;
  const fin = T.filter((t) => t.status !== 'processing');
  const failed = fin.filter((t) => t.status === 'error').length;
  const lat = fin.map((t) => t.durationMs!).sort((a, b) => a - b);
  const span = fin.length ? Math.max(...fin.map((t) => t.endMs!)) - Math.min(...fin.map((t) => t.startMs)) : 0;
  const cnt = (f: (t: (typeof T)[number]) => boolean) => T.reduce((n, t) => n + (f(t) ? 1 : 0), 0);
  const retained = cnt((t) => t.sampling.state === 'retained');
  const dropped = cnt((t) => t.sampling.state === 'dropped');
  const incomplete = cnt((t) => t.sampling.state === 'incomplete');
  const evaluated = retained + dropped + incomplete;
  const exp = T.filter((t) => t.exportedAt != null);
  const exported = exp.length;
  const exportFailed = cnt((t) => t.export === 'failed');
  const queueDropped = cnt((t) => t.export === 'dropped');
  const exTimes = exp.map((t) => t.exportedAt!);
  const exSpan = exTimes.length ? Math.max(...exTimes) - Math.min(...exTimes) : 0;
  const processing = sim.inflight;
  return {
    generated: sim.generated, waiting: sim.waiting.length, processing, completed: fin.length - failed, failed, finished: fin.length,
    throughput: span > 0 ? fin.length / (span / 1000) : 0, avgLatency: avg(lat), p95Latency: percentile(lat, 95), errorRate: fin.length ? (failed / fin.length) * 100 : 0,
    traces: fin.length, spans: fin.reduce((n, t) => n + t.spans.length, 0),
    evaluated, retained, dropped, incomplete, lost: cnt((t) => t.sampling.state === 'lost'), pendingSampling: sim.pendingSampling,
    errorRetained: cnt((t) => t.sampling.code === 'error' && t.sampling.state === 'retained'),
    slowRetained: cnt((t) => t.sampling.code === 'slow' && t.sampling.state === 'retained'),
    ordinaryRetained: cnt((t) => t.sampling.code === 'ordinary' && t.sampling.state === 'retained'),
    retentionPct: evaluated ? (retained / evaluated) * 100 : 0,
    batches: sim.batches.length, avgBatch: avg(sim.batches.map((b) => b.size)), queueNow: sim.buf.length + sim.held, maxQueue: sim.maxQueue,
    avgWaitMs: avg(exp.map((t) => t.exportedAt! - t.enqueuedAt!)),
    exported, exportFailed, queueDropped, exportSuccessRate: exported + exportFailed + queueDropped ? (exported / (exported + exportFailed + queueDropped)) * 100 : 0,
    exportThroughput: exSpan > 0 ? exported / (exSpan / 1000) : 0, exportRetries: sim.exportRetries,
    indexed: cnt((t) => t.index === 'indexed'), indexPending: cnt((t) => t.index === 'pending'), indexFailed: cnt((t) => t.index === 'failed'), peakIndexPending: sim.maxIndexPending,
    archivedObjects: sim.objects.length, archivedTraces: cnt((t) => t.archive === 'archived'), archivePending: cnt((t) => t.archive === 'pending'), archiveFailures: sim.archiveFailures, peakArchivePending: sim.maxArchPending,
    virtualTimeMs: sim.now, done: sim.isDone(),
  };
}

export type NodeId = 'traffic' | 'A' | 'B' | 'C' | 'collector' | 'tail' | 'batch' | 'exporter' | 'opensearch' | 'archival' | 'cold';
export interface NodeStat { status: 'ok' | 'warn' | 'down' | 'idle'; inCount: number; outCount: number; note: string }

/** Per-node status and input/output counts, derived from simulator state (used by the architecture canvas). */
export function componentStats(sim: Simulator, m: Summary): Record<NodeId, NodeStat> {
  const t = sim.now;
  const svc = (s: ServiceId): NodeStat => {
    const spans = sim.traces.flatMap((x) => x.spans.filter((p) => p.service === s && p.endMs <= t));
    const down = sim.svcDown(s, t);
    const degraded = !!sim.active('service_latency', t, s) || !!sim.active('service_errors', t, s);
    return { status: down ? 'down' : degraded ? 'warn' : spans.length ? 'ok' : 'idle', inCount: spans.length, outCount: spans.filter((p) => p.status === 'ok').length, note: down ? 'UNAVAILABLE' : degraded ? 'DEGRADED' : 'healthy' };
  };
  const busy = sim.generated > 0;
  return {
    traffic: { status: busy ? 'ok' : 'idle', inCount: m.generated, outCount: m.generated - m.waiting, note: `${m.processing} in flight` },
    A: svc('A'), B: svc('B'), C: svc('C'),
    collector: { status: sim.active('collector_slow', t) ? 'down' : sim.collectorWaiting > 20 ? 'warn' : busy ? 'ok' : 'idle', inCount: m.finished, outCount: m.finished - sim.collectorWaiting - m.lost, note: `backlog ${sim.collectorWaiting}` },
    tail: { status: sim.pendingSampling > 0 ? 'warn' : busy ? 'ok' : 'idle', inCount: m.evaluated + m.pendingSampling, outCount: m.retained, note: `${m.pendingSampling} pending decision` },
    batch: { status: sim.active('queue_saturation', t) ? 'down' : m.queueNow > sim.cfg.batch.size * 3 ? 'warn' : busy ? 'ok' : 'idle', inCount: m.retained - m.queueDropped, outCount: m.exported + m.exportFailed, note: `queue ${m.queueNow}` },
    exporter: { status: sim.exporterDown(t) ? 'down' : busy ? 'ok' : 'idle', inCount: m.exported + m.exportFailed + sim.held, outCount: m.exported, note: `${m.batches} batches` },
    opensearch: { status: sim.indexDown(t) ? 'down' : m.indexPending > 0 ? 'warn' : busy ? 'ok' : 'idle', inCount: m.exported, outCount: m.indexed, note: `${m.indexPending} pending` },
    archival: { status: m.archivePending > 0 ? 'warn' : busy ? 'ok' : 'idle', inCount: m.exported, outCount: m.archivedTraces, note: `${m.archivePending} waiting` },
    cold: { status: sim.coldDown(t) ? 'down' : busy ? 'ok' : 'idle', inCount: m.archivedTraces, outCount: m.archivedObjects, note: `${m.archivedObjects} objects` },
  };
}
