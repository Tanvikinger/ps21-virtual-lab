import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startStack } from './helpers.mjs';

// Fake CloudWatch adapter: records what the backend sends and serves it back, like AWS would.
function fakeAdapter() {
  const puts = []; const alarms = [];
  return {
    puts, alarms,
    async putMetrics(ns, data) { puts.push({ ns, data }); },
    async getMetrics({ metrics }) { return Object.fromEntries(metrics.map((m) => [m.name, puts.flatMap((p) => p.data).filter((d) => d.MetricName === m.name).map((d) => ({ t: d.Timestamp.getTime(), v: d.Value }))])); },
    async putAlarm(p) { alarms.push(p); },
    async listAlarms(prefix) { return alarms.filter((a) => a.AlarmName.startsWith(prefix)).map((a) => ({ name: a.AlarmName, state: 'OK', threshold: a.Threshold })); },
  };
}

test('CloudWatch disabled: endpoints answer 503 cloudwatch_disabled and nothing is sent', async () => {
  const s = await startStack();
  try {
    const r = await fetch(`${s.base}/cloudwatch/metrics`); const j = await r.json();
    assert.equal(r.status, 503); assert.equal(j.error, 'cloudwatch_disabled');
    assert.equal((await (await fetch(`${s.base}/cloudwatch/status`)).json()).enabled, false);
  } finally { await s.stop(); }
});

test('CloudWatch enabled: traffic is published as custom metrics and can be read back', async () => {
  const adapter = fakeAdapter();
  const s = await startStack({ CLOUDWATCH_ENABLED: 'true', CLOUDWATCH_NAMESPACE: 'Test/Telemetry', DEPLOY_ENV: 'unit', OPENSEARCH_URL: 'http://127.0.0.1:9' }, { cloudwatchAdapter: adapter });
  try {
    await s.post('/simulate', { count: 20, concurrency: 5, errorRate: 0.5, slowRate: 0, baseLatencyMs: 1, seed: 7 });
    const pub = await (await s.post('/cloudwatch/publish')).json();
    assert.ok(pub.published >= 5, JSON.stringify(pub));
    const sent = adapter.puts[0]; assert.equal(sent.ns, 'Test/Telemetry');
    const by = Object.fromEntries(sent.data.map((d) => [d.MetricName, d]));
    assert.equal(by.Requests.Value, 20); assert.equal(by.Requests.Unit, 'Count');
    assert.ok(by.FailedRequests.Value > 0 && by.FailedRequests.Value < 20);
    assert.equal(by.ErrorRatePercent.Value, (100 * by.FailedRequests.Value) / 20);
    assert.deepEqual(by.Requests.Dimensions, [{ Name: 'Environment', Value: 'unit' }]);
    const back = await (await fetch(`${s.base}/cloudwatch/metrics?minutes=30`)).json();
    assert.equal(back.series.Requests[0].v, 20);
    const st = await (await fetch(`${s.base}/cloudwatch/status`)).json();
    assert.equal(st.enabled, true); assert.equal(st.publishedBatches, 1); assert.equal(st.lastError, null);
    // nothing new happened -> the periodic publish is skipped, a forced one still works
    assert.equal((await s.stack.cloudwatch.publish()).skipped, true);
  } finally { await s.stop(); }
});

test('CloudWatch alarm is created with the configured threshold and listed back', async () => {
  const adapter = fakeAdapter();
  const s = await startStack({ CLOUDWATCH_ENABLED: 'true', CLOUDWATCH_ERROR_ALARM_PCT: '30' }, { cloudwatchAdapter: adapter });
  try {
    const c = await (await s.post('/cloudwatch/alarms')).json();
    assert.equal(c.thresholdPct, 30); assert.equal(adapter.alarms[0].MetricName, 'ErrorRatePercent'); assert.equal(adapter.alarms[0].Threshold, 30);
    const l = await (await fetch(`${s.base}/cloudwatch/alarms`)).json();
    assert.equal(l.alarms.length, 1);
  } finally { await s.stop(); }
});

test('AWS failure is reported honestly (502) and data is kept for the next publish', async () => {
  const adapter = { ...fakeAdapter(), async putMetrics() { throw new Error('Could not load credentials from any providers'); } };
  const s = await startStack({ CLOUDWATCH_ENABLED: 'true' }, { cloudwatchAdapter: adapter });
  try {
    await s.post('/simulate', { count: 5, concurrency: 2, errorRate: 0, slowRate: 0, baseLatencyMs: 1 });
    const r = await s.post('/cloudwatch/publish'); const j = await r.json();
    assert.equal(r.status, 502); assert.match(j.message, /credentials/);
    assert.match((await (await fetch(`${s.base}/cloudwatch/status`)).json()).lastError, /credentials/);
  } finally { await s.stop(); }
});

test('GET /metrics/history returns time-series points with latency and error rate', async () => {
  const s = await startStack({ HISTORY_INTERVAL_MS: '0', OPENSEARCH_URL: 'http://127.0.0.1:9', COLLECTOR_METRICS_URL: 'http://127.0.0.1:9/metrics' });
  try {
    await s.post('/simulate', { count: 30, concurrency: 5, errorRate: 0.3, slowRate: 0, baseLatencyMs: 2, seed: 3 });
    await s.stack.history.sample();
    const j = await (await fetch(`${s.base}/metrics/history?minutes=5`)).json();
    assert.equal(j.points.length, 1);
    const p = j.points[0]; assert.equal(p.requests, 30); assert.equal(p.ok + p.failed, 30);
    assert.ok(p.errorRate > 0 && p.avgLatencyMs > 0 && p.p95LatencyMs >= p.avgLatencyMs * 0.5);
    assert.ok(p.sdkGenerated > 0); assert.equal(p.indexedSpans, null); // OpenSearch not running here -> honest null, not a fake 0
  } finally { await s.stop(); }
});
