import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startStack } from './helpers.mjs';

const byTrace = (spans) => { const m = new Map(); for (const s of spans) (m.get(s.traceId) ?? m.set(s.traceId, []).get(s.traceId)).push(s); return m; };

test('real OTLP spans: 5 spans/trace, 3 service names, correct parent-child, same trace id as API', async () => {
  const s = await startStack();
  try {
    const run = await (await s.post('/simulate', { count: 4, errorRate: 0, slowRate: 0, baseLatencyMs: 5, seed: 1 })).json();
    await s.waitForSpans(20);
    const traces = byTrace(s.otlp.spans);
    assert.equal(traces.size, 4);
    for (const r of run.requests) {
      const spans = traces.get(r.traceId); assert.ok(spans, 'API trace id must exist on the wire'); assert.equal(spans.length, 5);
      assert.deepEqual([...new Set(spans.map((x) => x.service))].sort(), ['service-a', 'service-b', 'service-c']);
      const ids = new Set(spans.map((x) => x.spanId));
      const roots = spans.filter((x) => !x.parentSpanId); assert.equal(roots.length, 1); assert.equal(roots[0].service, 'service-a');
      for (const sp of spans.filter((x) => x.parentSpanId)) assert.ok(ids.has(sp.parentSpanId), `parent of ${sp.name} must be in same trace`);
      const c = spans.find((x) => x.service === 'service-c'); const parent = spans.find((x) => x.spanId === c.parentSpanId);
      assert.equal(parent.service, 'service-b'); // C's parent is B's CLIENT span => context really propagated over HTTP
      assert.ok(spans.every((x) => /^[0-9a-f]{32}$/.test(x.traceId) && /^[0-9a-f]{16}$/.test(x.spanId)));
    }
    const stats = s.stack.telemetry.stats; assert.equal(stats.generated.A + stats.generated.B + stats.generated.C, 20); assert.ok(stats.exportedSpans >= 20);
  } finally { await s.stop(); }
});

test('error in service C: ERROR status + exception event recorded, errors propagate to B and A', async () => {
  const s = await startStack();
  try {
    const run = await (await s.post('/simulate', { count: 1, errorRate: 1, failService: 'C', slowRate: 0, baseLatencyMs: 5 })).json();
    const r = run.requests[0]; assert.equal(r.status, 'error'); assert.equal(r.failedService, 'C'); assert.equal(r.httpStatus, 502);
    await s.waitForSpans(5);
    const spans = s.otlp.spans.filter((x) => x.traceId === r.traceId); assert.equal(spans.length, 5);
    const server = (svc) => spans.find((x) => x.service === svc && x.kind === 2);
    const c = server('service-c');
    assert.equal(c.status.code, 2); assert.ok(c.events.some((e) => e.name === 'exception'), 'exception recorded on origin span');
    assert.equal(c.attributes.find((a) => a.key === 'sim.injected_fault')?.value.boolValue, true);
    assert.equal(server('service-b').status.code, 2); assert.equal(server('service-a').status.code, 2);
    assert.match(server('service-a').status.message, /Downstream service-c failed/);
  } finally { await s.stop(); }
});

test('crashing service B yields a real connection error; recovery restores the chain', async () => {
  const s = await startStack();
  try {
    assert.equal((await s.post('/faults/B/crash')).status, 200);
    assert.equal((await (await fetch(`${s.base}/health`)).json()).status, 'degraded');
    const down = (await (await s.post('/simulate', { count: 1, errorRate: 0, slowRate: 0, baseLatencyMs: 1 })).json()).requests[0];
    assert.equal(down.status, 'error'); assert.equal(down.failedService, 'B'); assert.match(down.error, /unreachable/);
    await s.post('/faults/B/recover');
    const up = (await (await s.post('/simulate', { count: 1, errorRate: 0, slowRate: 0, baseLatencyMs: 1 })).json()).requests[0];
    assert.equal(up.status, 'ok');
    assert.equal((await (await fetch(`${s.base}/health`)).json()).status, 'ok');
  } finally { await s.stop(); }
});

test('persistent fault injection (error rate + latency) can be set and cleared', async () => {
  const s = await startStack();
  try {
    assert.equal((await s.post('/faults', { service: 'C', errorRate: 1 })).status, 200);
    const bad = (await (await s.post('/simulate', { count: 3, errorRate: 0, slowRate: 0, baseLatencyMs: 1 })).json()).summary; assert.equal(bad.failed, 3);
    await fetch(`${s.base}/faults`, { method: 'DELETE' });
    const good = (await (await s.post('/simulate', { count: 3, errorRate: 0, slowRate: 0, baseLatencyMs: 1 })).json()).summary; assert.equal(good.failed, 0);
    assert.equal((await s.post('/faults', { service: 'Q' })).status, 400);
  } finally { await s.stop(); }
});

test('SDK export failures are counted, not hidden, when the collector is unreachable', async () => {
  const s = await startStack({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:9', OTEL_BSP_EXPORT_TIMEOUT: '1000' });
  try {
    await s.post('/simulate', { count: 2, errorRate: 0, slowRate: 0, baseLatencyMs: 1 });
    await s.stack.telemetry.forceFlush().catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
    const m = await (await fetch(`${s.base}/pipeline/metrics`)).json();
    assert.ok(m.sdk.generatedTotal >= 10); assert.ok(m.sdk.failedSpans > 0); assert.equal(m.sdk.exportedSpans, 0);
    assert.ok(m.collectorError, 'collector scrape error is surfaced');
  } finally { await s.stop(); }
});
