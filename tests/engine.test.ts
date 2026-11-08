import { describe, it, expect } from 'vitest';
import { Simulator } from '../src/engine/simulationEngine';
import { computeMetrics, percentile } from '../src/engine/metrics';
import { DEFAULT_CONFIG, merge, type DeepPartial } from '../src/engine/config';
import { compareRuns, runConfig, toCSV } from '../src/engine/experiments';
import type { Config } from '../src/engine/types';

const cfg = (p: DeepPartial<Config>) => merge(DEFAULT_CONFIG, p);
const run = (p: DeepPartial<Config>) => new Simulator(cfg(p)).runToEnd();
const clean = { traffic: { errorProb: 0, slowProb: 0, totalRequests: 40 } };

describe('traces and spans', () => {
  it('1. a successful request generates spans for A, B and C', () => {
    const s = run(clean);
    expect(s.traces).toHaveLength(40);
    for (const t of s.traces) { expect(t.status).toBe('success'); expect(t.services).toEqual(['A', 'B', 'C']); }
  });
  it('2. trace IDs are consistent across spans and unique across traces', () => {
    const s = run(clean);
    for (const t of s.traces) { expect(t.id).toHaveLength(32); for (const sp of t.spans) expect(sp.traceId).toBe(t.id); }
    expect(new Set(s.traces.map((t) => t.id)).size).toBe(40);
  });
  it('3. parent-child relationships and time nesting are correct', () => {
    const s = run(clean);
    for (const t of s.traces) {
      const [a, b, c] = t.spans;
      expect(a.parentId).toBe(null); expect(b.parentId).toBe(a.id); expect(c.parentId).toBe(b.id);
      expect(b.startMs).toBeGreaterThanOrEqual(a.startMs); expect(b.endMs).toBeLessThanOrEqual(a.endMs);
      expect(c.startMs).toBeGreaterThanOrEqual(b.startMs); expect(c.endMs).toBeLessThanOrEqual(b.endMs);
    }
  });
  it('4. an unavailable service changes the request outcome', () => {
    const s = run({ ...clean, services: { B: { available: false } } });
    for (const t of s.traces) {
      expect(t.status).toBe('error'); expect(t.services).toEqual(['A', 'B']);
      expect(t.spans[1].origin).toBe(true); expect(t.spans[0].status).toBe('error'); expect(t.spans[0].origin).toBe(undefined);
    }
    expect(computeMetrics(s).failed).toBe(40);
  });
});

describe('sampling', () => {
  const base = { traffic: { errorProb: 0.3, slowProb: 0, totalRequests: 150 }, sampling: { ordinaryPct: 0, retainSlow: false } };
  it('5. retains error traces when configured, and not when disabled', () => {
    const on = run({ ...base, sampling: { ...base.sampling, retainErrors: true } });
    const errs = on.traces.filter((t) => t.status === 'error');
    expect(errs.length).toBeGreaterThan(5);
    for (const t of errs) expect(t.sampling.code).toBe('error');
    expect(computeMetrics(on).retained).toBe(errs.length);
    const off = run({ ...base, sampling: { ...base.sampling, retainErrors: false } });
    expect(computeMetrics(off).retained).toBe(0);
  });
  it('6. slow-trace retention respects the threshold', () => {
    const p = { traffic: { errorProb: 0, slowProb: 0.3, totalRequests: 150 }, sampling: { ordinaryPct: 0, retainErrors: false, retainSlow: true, slowThresholdMs: 250 } };
    const s = run(p);
    const kept = s.traces.filter((t) => t.sampling.state === 'retained');
    expect(kept.length).toBeGreaterThan(5);
    for (const t of s.traces) expect(t.sampling.state === 'retained').toBe(t.durationMs! >= 250);
    expect(computeMetrics(run({ ...p, sampling: { ...p.sampling, slowThresholdMs: 100000 } })).retained).toBe(0);
  });
  it('7. ordinary sampling follows the percentage and the seed', () => {
    const p = { traffic: { errorProb: 0, slowProb: 0, totalRequests: 200 } };
    expect(computeMetrics(run({ ...p, sampling: { ordinaryPct: 0 } })).retained).toBe(0);
    expect(computeMetrics(run({ ...p, sampling: { ordinaryPct: 100 } })).retained).toBe(200);
    const a = computeMetrics(run({ ...p, sampling: { ordinaryPct: 50 } })).retained;
    expect(a).toBeGreaterThan(60); expect(a).toBeLessThan(140);
    expect(computeMetrics(run({ ...p, sampling: { ordinaryPct: 50 } })).retained).toBe(a);
  });
});

describe('batching and queues', () => {
  const p = { ...clean, traffic: { ...clean.traffic, totalRequests: 100 }, sampling: { ordinaryPct: 100 } };
  it('8. batches respect size and timeout', () => {
    const bySize = run({ ...p, batch: { size: 10, timeoutMs: 1e6 } });
    expect(bySize.batches.length).toBe(10);
    for (const b of bySize.batches) { expect(b.size).toBe(10); expect(b.reason).toBe('size'); }
    const byTime = run({ ...p, batch: { size: 1000, timeoutMs: 300 } });
    for (const b of byTime.batches) { expect(b.reason).toBe('timeout'); expect(b.size).toBeLessThan(1000); }
    expect(byTime.batches.reduce((n, b) => n + b.size, 0)).toBe(100);
  });
  it('9. queue capacity drops records instead of growing without bound', () => {
    const s = run({ ...p, traffic: { ...p.traffic, arrivalRate: 100 }, batch: { size: 2, queueCapacity: 5, exportDelayMs: 2000 } });
    const m = computeMetrics(s);
    expect(m.queueDropped).toBeGreaterThan(0);
    expect(m.maxQueue).toBeLessThanOrEqual(5);
    expect(m.retained).toBe(m.exported + m.exportFailed + m.queueDropped);
  });
});

describe('storage and faults', () => {
  const p = { ...clean, sampling: { ordinaryPct: 100 } };
  it('10. indexed/archived only after the simulated operation succeeds', () => {
    const s = new Simulator(cfg({ ...p, faults: [{ kind: 'index_down', startMs: 0, endMs: 3000 }, { kind: 'cold_down', startMs: 0, endMs: 7000 }] }));
    s.advance(2500);
    expect(s.traces.some((t) => t.export === 'exported')).toBe(true);
    expect(s.traces.filter((t) => t.index === 'indexed')).toHaveLength(0);
    expect(s.traces.some((t) => t.index === 'pending')).toBe(true);
    s.advance(5000);
    expect(s.traces.some((t) => t.archive === 'archived')).toBe(false);
    s.runToEnd();
    for (const t of s.traces.filter((x) => x.export === 'exported')) {
      expect(t.index).toBe('indexed'); expect(t.indexedAt!).toBeGreaterThanOrEqual(3000);
      expect(t.archive).toBe('archived'); expect(t.archivedAt!).toBeGreaterThanOrEqual(7000);
    }
  });
  it('11. removing a fault restores later requests', () => {
    const s = new Simulator(cfg({ ...clean, traffic: { ...clean.traffic, totalRequests: 120 } }));
    s.advance(1000);
    const id = s.addFault({ kind: 'service_down', target: 'B', startMs: s.now, endMs: null });
    s.advance(2500);
    s.removeFault(id);
    s.runToEnd();
    expect(s.traces.some((t) => t.status === 'error')).toBe(true);
    for (const t of s.traces) {
      if (t.startMs >= 2600) expect(t.status).toBe('success');
      if (t.endMs! < 1000) expect(t.status).toBe('success');
    }
    expect(s.events.some((e) => e.type === 'recovery')).toBe(true);
  });
});

describe('metrics, reproducibility, comparison', () => {
  it('12. metrics are calculated from recorded data', () => {
    expect(percentile([10, 20, 30, 40], 95)).toBe(40);
    expect(percentile(Array.from({ length: 100 }, (_, i) => i + 1), 95)).toBe(95);
    const s = run({ traffic: { errorProb: 0.1, slowProb: 0.2, totalRequests: 100 } });
    const m = computeMetrics(s);
    const lat = s.traces.map((t) => t.durationMs!);
    expect(m.avgLatency).toBeCloseTo(lat.reduce((a, b) => a + b, 0) / lat.length, 6);
    expect(m.completed + m.failed).toBe(m.finished);
    expect(m.finished).toBe(m.generated);
    expect(m.errorRate).toBeCloseTo((m.failed / m.finished) * 100, 6);
    expect(m.retained).toBe(m.errorRetained + m.slowRetained + m.ordinaryRetained);
    expect(m.retentionPct).toBeCloseTo((m.retained / m.evaluated) * 100, 6);
    expect(m.spans).toBe(s.traces.reduce((n, t) => n + t.spans.length, 0));
  });
  it('13. the same seed reproduces results; a different seed does not', () => {
    const a = run({}), b = run({}), c = run({ traffic: { seed: 7 } });
    expect(JSON.stringify(computeMetrics(a))).toBe(JSON.stringify(computeMetrics(b)));
    expect(a.traces.map((t) => t.id)).toEqual(b.traces.map((t) => t.id));
    expect(a.traces[0].id === c.traces[0].id).toBe(false);
  });
  it('14. comparison reads saved summaries, not fresh placeholder values', () => {
    const r1 = runConfig(cfg({}), 'one'), r2 = runConfig(cfg({ traffic: { errorProb: 0.3 } }), 'two');
    const saved = JSON.parse(JSON.stringify([r1, r2]));
    saved[1].summary.avgLatency = 12345;
    const row = compareRuns(saved).find((r) => r.key === 'avgLatency')!;
    expect(row.values[0]).toBe(r1.summary.avgLatency);
    expect(row.values[1]).toBe(12345);
    expect(toCSV(saved)).toContain('12345');
  });
});
