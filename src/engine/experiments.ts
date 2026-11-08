import type { Config, SeriesPoint, SimEvent, Summary } from './types';
import { DEFAULT_CONFIG, merge, type DeepPartial } from './config';
import { Simulator } from './simulationEngine';
import { computeMetrics } from './metrics';

export interface MiniTrace { id: string; durationMs: number; status: string; services: string; sampling: string; export: string; index: string; archive: string }
export interface RunResult {
  id: string; name: string; label: string; experimentId?: string; ts: number; status: 'completed' | 'stopped-at-limit';
  config: Config; summary: Summary; series: SeriesPoint[]; events: SimEvent[]; traces: MiniTrace[];
}

/** Run a configuration headlessly to completion and capture everything needed to save/compare it later. */
export function runConfig(config: Config, label: string, name = label, experimentId?: string): RunResult {
  const sim = new Simulator(config).runToEnd();
  return captureRun(sim, label, name, experimentId);
}

export function captureRun(sim: Simulator, label: string, name: string, experimentId?: string): RunResult {
  const summary = computeMetrics(sim);
  const pick = [...sim.traces.filter((t) => t.status === 'error'), ...sim.traces.filter((t) => t.slow && t.status !== 'error'), ...sim.traces.filter((t) => t.status === 'success' && !t.slow)]
    .filter((t) => t.status !== 'processing').slice(0, 40);
  return {
    id: `run-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`, name, label, experimentId, ts: Date.now(),
    status: summary.done ? 'completed' : 'stopped-at-limit', config: JSON.parse(JSON.stringify(sim.cfg)), summary, series: sim.series,
    events: [...sim.events.filter((e) => e.type === 'fault' || e.type === 'recovery'), ...sim.events.slice(-60)],
    traces: pick.map((t) => ({ id: t.id, durationMs: Math.round(t.durationMs ?? 0), status: t.status, services: t.services.join('→'), sampling: t.sampling.reason, export: t.export, index: t.index, archive: t.archive })),
  };
}

export const COMPARE_METRICS: { key: keyof Summary; label: string; unit: string }[] = [
  { key: 'avgLatency', label: 'Average latency', unit: 'ms' }, { key: 'p95Latency', label: 'p95 latency', unit: 'ms' },
  { key: 'throughput', label: 'Request throughput', unit: 'req/s' }, { key: 'errorRate', label: 'Error rate', unit: '%' },
  { key: 'retained', label: 'Traces retained', unit: '' }, { key: 'dropped', label: 'Traces dropped (policy)', unit: '' },
  { key: 'lost', label: 'Telemetry lost before sampling', unit: '' }, { key: 'incomplete', label: 'Incomplete traces', unit: '' },
  { key: 'batches', label: 'Batches formed', unit: '' }, { key: 'avgBatch', label: 'Average batch size', unit: '' },
  { key: 'avgWaitMs', label: 'Avg wait in batch queue', unit: 'ms' }, { key: 'maxQueue', label: 'Peak queue depth', unit: 'records' },
  { key: 'exportSuccessRate', label: 'Export success rate', unit: '%' }, { key: 'indexed', label: 'Traces indexed', unit: '' },
  { key: 'peakIndexPending', label: 'Peak index backlog', unit: 'records' }, { key: 'indexPending', label: 'Index still pending (end)', unit: '' }, { key: 'indexFailed', label: 'Indexing failed', unit: '' },
  { key: 'archivedObjects', label: 'Archive objects', unit: '' }, { key: 'archivedTraces', label: 'Traces archived', unit: '' },
  { key: 'peakArchivePending', label: 'Peak archive backlog', unit: 'records' }, { key: 'archivePending', label: 'Archive still pending (end)', unit: '' },
];

/** Comparison rows are read straight from the saved summaries; nothing is re-simulated. */
export function compareRuns(runs: RunResult[]) {
  return COMPARE_METRICS.map((m) => ({ ...m, values: runs.map((r) => r.summary[m.key] as number) }));
}
export function toCSV(runs: RunResult[]): string {
  const rows = [['metric', 'unit', ...runs.map((r) => JSON.stringify(r.name))].join(',')];
  for (const r of compareRuns(runs)) rows.push([JSON.stringify(r.label), r.unit, ...r.values.map((v) => Number(v.toFixed(3)))].join(','));
  rows.push(['seed', '', ...runs.map((r) => r.config.traffic.seed)].join(','));
  return rows.join('\n');
}

// ---------------- predefined experiments ----------------
export interface Variant { label: string; config: Config }
export interface ExperimentDef {
  id: string; title: string; objective: string; expected: string; learned: string;
  variants: () => Variant[]; why: (r: RunResult[]) => string[];
}
const P = (p: DeepPartial<Config>) => merge(DEFAULT_CONFIG, p);
const f = (n: number, d = 1) => n.toFixed(d);
const maxBacklog = (r: RunResult) => Math.max(0, ...r.series.map((s) => s.collectorBacklog));

export const EXPERIMENTS: ExperimentDef[] = [
  {
    id: 'baseline', title: '1. Baseline System', objective: 'Run normal traffic and record baseline latency, error rate, retention and throughput.',
    expected: 'Latency close to three service hops, a small error rate, and most telemetry flowing through to indexing and archive.',
    learned: 'A baseline gives you something to compare every fault and configuration change against.',
    variants: () => [{ label: 'Baseline', config: P({}) }],
    why: ([a]) => [`Each request calls three services of ~${a.config.traffic.baseLatencyMs} ms, so average latency (${f(a.summary.avgLatency)} ms) sits above 3 x ${a.config.traffic.baseLatencyMs} ms because slow requests add to it.`,
      `With ${a.config.traffic.errorProb * 100}% error probability per call, a request fails roughly 1-(1-p)^3 of the time; observed error rate was ${f(a.summary.errorRate)}%.`,
      `Retention was ${f(a.summary.retentionPct)}% of evaluated traces: all errors and slow traces are kept plus ${a.config.sampling.ordinaryPct}% of ordinary ones.`],
  },
  {
    id: 'high', title: '2. High Traffic', objective: 'Increase the arrival rate and watch the collector queue and latency.',
    expected: 'Higher throughput; the collector backlog grows when arrivals exceed its capacity, which can add telemetry delay.',
    learned: 'Telemetry pipelines have finite capacity; load that is fine for the app can still stress the collector.',
    variants: () => [{ label: 'Baseline 20 req/s', config: P({}) }, { label: 'High traffic 150 req/s', config: P({ traffic: { arrivalRate: 150, totalRequests: 600 }, collector: { msPerTrace: 8 } }) }],
    why: ([a, b]) => [`Throughput rose from ${f(a.summary.throughput)} to ${f(b.summary.throughput)} req/s.`,
      `The collector handles one trace per ${b.config.collector.msPerTrace} ms (~${f(1000 / b.config.collector.msPerTrace, 0)} traces/s) while ${b.config.traffic.arrivalRate} traces/s arrive, so its backlog peaked at ${maxBacklog(b)} (baseline: ${maxBacklog(a)}).`,
      `Lost telemetry before sampling: ${b.summary.lost}; incomplete traces: ${b.summary.incomplete} (their spans waited in the collector longer than the ${b.config.sampling.waitMs} ms sampling window, so retention fell to ${f(b.summary.retentionPct)}%).`],
  },
  {
    id: 'sampling', title: '3. Tail Sampling', objective: 'Generate successful, slow and failed requests, then compare retained and dropped traces with and without error/slow rules.',
    expected: 'With error and slow rules on, nearly all errors and slow traces are kept; with them off only the ordinary percentage survives.',
    learned: 'Tail sampling decides after seeing the whole trace, so it can keep the interesting ones while dropping most boring ones.',
    variants: () => {
      const base = { traffic: { errorProb: 0.08, slowProb: 0.2, totalRequests: 300 }, sampling: { ordinaryPct: 10 } };
      return [{ label: 'Error + slow rules ON', config: P(base) }, { label: 'Rules OFF (10% random only)', config: P({ ...base, sampling: { ordinaryPct: 10, retainErrors: false, retainSlow: false } }) }];
    },
    why: ([a, b]) => [`With rules on, ${a.summary.errorRetained} error and ${a.summary.slowRetained} slow traces were kept out of ${a.summary.evaluated} evaluated (${f(a.summary.retentionPct)}% retention).`,
      `With rules off, only ${b.summary.retained} were kept (${f(b.summary.retentionPct)}%). Error-rule retentions: ${b.summary.errorRetained}; any error traces that survived were kept only by the random ordinary policy.`,
      'A trace that is both an error and slow is counted once, under Error (error has priority).'],
  },
  {
    id: 'batch', title: '4. Batch Size Comparison', objective: 'Run the same seeded workload with small and large batches.',
    expected: 'Small batches: many batches, short waiting. Large batches: fewer batches, longer waiting until the batch fills or times out.',
    learned: 'Batching trades latency (waiting for a batch to fill) for efficiency (less per-batch overhead).',
    variants: () => { const b = { traffic: { totalRequests: 300 }, sampling: { ordinaryPct: 60 }, batch: { timeoutMs: 2000 } }; return [{ label: 'Batch size 5', config: P({ ...b, batch: { ...b.batch, size: 5 } }) }, { label: 'Batch size 50', config: P({ ...b, batch: { ...b.batch, size: 50 } }) }]; },
    why: ([a, b]) => [`Size 5 formed ${a.summary.batches} batches (avg ${f(a.summary.avgBatch)}); size 50 formed ${b.summary.batches} (avg ${f(b.summary.avgBatch)}).`,
      `Average wait before export: ${f(a.summary.avgWaitMs)} ms vs ${f(b.summary.avgWaitMs)} ms.`,
      `Peak queue depth: ${a.summary.maxQueue} vs ${b.summary.maxQueue}. Both runs used identical requests (same seed), so differences come only from batching.`],
  },
  {
    id: 'service', title: '5. Service Failure', objective: 'Make Service B unavailable from 2.0s to 5.0s and inspect failed requests and traces.',
    expected: 'Requests that arrive during the outage fail at Service B; their traces have only A and B spans; normal behaviour returns afterwards.',
    learned: 'Traces show exactly where a request failed, and the failure stops when the fault is removed.',
    variants: () => [{ label: 'No fault', config: P({}) }, { label: 'Service B down 2-5s', config: P({ faults: [{ kind: 'service_down', target: 'B', startMs: 2000, endMs: 5000 }] }) }],
    why: ([a, b]) => [`Error rate went from ${f(a.summary.errorRate)}% to ${f(b.summary.errorRate)}% (${b.summary.failed} failed requests).`,
      `Spans generated fell from ${a.summary.spans} to ${b.summary.spans} because failed requests never reach Service C. Average latency moved from ${f(a.summary.avgLatency)} to ${f(b.summary.avgLatency)} ms: failed requests return early, so averages alone can hide an outage.`,
      'Failed traces are retained by the error rule, so they are easy to find in Live Traces (filter Status = Error).'],
  },
  {
    id: 'collector', title: '6. Collector Bottleneck', objective: 'Make the collector slower than the incoming telemetry rate.',
    expected: 'Collector backlog grows, then telemetry is lost or arrives too late for the tail-sampling window.',
    learned: 'If the pipeline cannot keep up, you lose observability data exactly when the system is busiest.',
    variants: () => [{ label: 'Healthy collector', config: P({ traffic: { arrivalRate: 40, totalRequests: 300 } }) }, { label: 'Slow collector (40 ms/trace)', config: P({ traffic: { arrivalRate: 40, totalRequests: 300 }, collector: { msPerTrace: 40, backlogLimit: 30 } }) }],
    why: ([a, b]) => [`Peak collector backlog: ${maxBacklog(a)} vs ${maxBacklog(b)}.`,
      `Telemetry lost at the collector: ${a.summary.lost} vs ${b.summary.lost}; incomplete (waited longer than the sampling window): ${a.summary.incomplete} vs ${b.summary.incomplete}.`,
      `Only ${b.summary.evaluated} of ${b.summary.traces} traces were evaluated by sampling in the slow run.`],
  },
  {
    id: 'index', title: '7. Indexing Outage', objective: 'Disable searchable storage, observe pending records, then restore it.',
    expected: 'Short outage: records stay Pending and are indexed after recovery. Very long outage: retries run out and some records fail.',
    learned: 'Retries and buffering can absorb short outages, but only up to the limits that are actually configured.',
    variants: () => { const b = { sampling: { ordinaryPct: 100 } }; return [{ label: 'No outage', config: P(b) }, { label: 'Outage 2-6s', config: P({ ...b, faults: [{ kind: 'index_down', startMs: 2000, endMs: 6000 }] }) }, { label: 'Outage 2-25s', config: P({ ...b, faults: [{ kind: 'index_down', startMs: 2000, endMs: 25000 }] }) }]; },
    why: ([, b, c]) => [`4 s outage: index backlog peaked at ${b.summary.peakIndexPending} records, then ${b.summary.indexed} were indexed (${b.summary.indexFailed} failed, ${b.summary.indexPending} pending at the end) - the retry window (~10 s) covered it.`,
      `23 s outage: backlog peaked at ${c.summary.peakIndexPending}; ${c.summary.indexed} indexed, ${c.summary.indexFailed} permanently failed, ${c.summary.indexPending} pending. Records that exhausted their 12 attempts were lost from search.`,
      'A trace is only shown as Indexed after its simulated indexing succeeds.'],
  },
  {
    id: 'cold', title: '8. Cold Storage Outage', objective: 'Disable cold object storage and observe archival failures and recovery.',
    expected: 'Archive attempts fail while storage is down; waiting traces are archived after it returns. If it never returns they stay pending.',
    learned: 'Archival is decoupled from search: indexed traces stay searchable even when the archive is down.',
    variants: () => { const b = { sampling: { ordinaryPct: 100 } }; return [{ label: 'Healthy', config: P(b) }, { label: 'Outage 0-8s', config: P({ ...b, faults: [{ kind: 'cold_down', startMs: 0, endMs: 8000 }] }) }, { label: 'Never recovers', config: P({ ...b, storage: { coldAvailable: false } }) }]; },
    why: ([a, b, c]) => [`Archive failures during outage: ${b.summary.archiveFailures}; archive backlog peaked at ${b.summary.peakArchivePending} (healthy run: ${a.summary.peakArchivePending}); after recovery ${b.summary.archivedTraces}/${b.summary.exported} traces archived in ${b.summary.archivedObjects} objects (healthy run: ${a.summary.archivedObjects} objects).`,
      `Permanent outage: ${c.summary.archivedTraces} archived, ${c.summary.archivePending} still waiting, but ${c.summary.indexed} were indexed and searchable.`],
  },
  {
    id: 'recovery', title: '9. Recovery Comparison', objective: 'Compare a normal run, a run with Service B + indexing faults (2-5s), and a longer run that continues after recovery.',
    expected: 'The fault run shows failures and delayed indexing; the longer run shows the system returning to normal once the faults are removed.',
    learned: 'Reliability is about behaviour during and after a fault, not just whether faults happen.',
    variants: () => { const fl = [{ kind: 'service_down' as const, target: 'B' as const, startMs: 2000, endMs: 5000 }, { kind: 'index_down' as const, startMs: 2000, endMs: 5000 }]; const b = { sampling: { ordinaryPct: 100 } };
      return [{ label: 'Normal', config: P(b) }, { label: 'Faults 2-5s', config: P({ ...b, faults: fl }) }, { label: 'Faults + long tail', config: P({ ...b, traffic: { totalRequests: 400 }, faults: fl }) }]; },
    why: ([a, b, c]) => [`Error rate: ${f(a.summary.errorRate)}% normal, ${f(b.summary.errorRate)}% with faults, ${f(c.summary.errorRate)}% when 400 requests dilute the same outage.`,
      `Indexing: ${b.summary.indexed} indexed, ${b.summary.indexPending} pending, ${b.summary.indexFailed} failed in the fault run - indexing caught up after the storage returned.`,
      `Failed requests (${b.summary.failed}) are the part that did NOT recover: no retry exists on the request path in this model.`],
  },
];

export function observedLines(results: RunResult[]): string[] {
  return results.map((r) => { const s = r.summary; return `${r.label}: ${s.finished} requests, avg ${f(s.avgLatency)} ms, p95 ${f(s.p95Latency)} ms, errors ${f(s.errorRate)}%, retained ${s.retained}/${s.evaluated} (${f(s.retentionPct)}%), ${s.batches} batches (avg ${f(s.avgBatch)}), indexed ${s.indexed}, archived ${s.archivedTraces}, lost ${s.lost}.`; });
}
