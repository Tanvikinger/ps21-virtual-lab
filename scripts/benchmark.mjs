// Measures ONE scenario against the currently running stack. All numbers come from the real Collector metrics,
// the backend SDK counters, and the sink that actually received the data. Nothing is estimated.
//   node scripts/benchmark.mjs --label sampling-on-batch512 --sink opensearch:http://localhost:9200
import fs from 'node:fs';
import path from 'node:path';
import { readSink } from './lib/sinks.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const api = arg('api', 'http://localhost:4000'); const sink = arg('sink', 'opensearch:http://localhost:9200');
const label = arg('label', 'run'); const count = Number(arg('count', 2000)); const conc = Number(arg('concurrency', 50));
const maxDrainS = Number(arg('max-drain', 60)); const outDir = arg('out', 'benchmarks/results');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const metrics = async () => (await fetch(`${api}/pipeline/metrics`)).json();

async function sinkBytes() {
  if (sink.startsWith('file:')) { const p = sink.slice(5); return fs.existsSync(p) ? fs.statSync(p).size : 0; }
  const base = sink.replace(/^opensearch:/, '');
  await fetch(`${base}/otel-v1-apm-span-*/_refresh?ignore_unavailable=true`, { method: 'POST' }).catch(() => {});
  const r = await fetch(`${base}/otel-v1-apm-span-*/_stats/store?ignore_unavailable=true&allow_no_indices=true`);
  return r.ok ? (await r.json())._all?.primaries?.store?.size_in_bytes ?? 0 : 0;
}

const m0 = await metrics(); const bytes0 = await sinkBytes();
const tStart = Date.now();
const res = await fetch(`${api}/simulate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ count, concurrency: conc, errorRate: 0.1, slowRate: 0.1, slowExtraMs: 700, baseLatencyMs: 40, seed: 42, includeSpans: false }) });
if (!res.ok) { console.error(await res.text()); process.exit(2); }
const run = await res.json(); const tWorkloadEnd = Date.now();

// Wait until the pipeline has drained: collector exported-span counter stable for 3 polls (and everything received).
let last = -1; let stable = 0; let m1;
while ((Date.now() - tWorkloadEnd) / 1000 < maxDrainS) {
  await sleep(2000); m1 = await metrics();
  const exp = m1.collector?.exportedSpans ?? 0; const rec = m1.collector?.receivedSpans ?? 0;
  const gen = m1.sdk.generatedTotal - m0.sdk.generatedTotal;
  stable = exp === last && rec - (m0.collector?.receivedSpans ?? 0) >= gen ? stable + 1 : 0; last = exp;
  if (stable >= 3) break;
}
const tDrained = Date.now() - 6000; // last 3 polls (6s) were confirmation only
await sleep(60000);
const stored = await readSink(sink); const bytes1 = await sinkBytes();

const d = (a, b) => (a ?? 0) - (b ?? 0);
const mine = new Set(run.requests.map((r) => r.traceId).filter(Boolean));
let sinkSpans = 0; let sinkTraces = 0; for (const [id, t] of stored) if (mine.has(id)) { sinkTraces += 1; sinkSpans += t.spans.size; }
const errTraces = run.requests.filter((r) => r.status === 'error' && r.traceId); const errKept = errTraces.filter((r) => stored.has(r.traceId)).length;
const generated = m1.sdk.generatedTotal - m0.sdk.generatedTotal;
const received = d(m1.collector?.receivedSpans, m0.collector?.receivedSpans); const exported = d(m1.collector?.exportedSpans, m0.collector?.exportedSpans);
const bytesAdded = bytes1 - bytes0;
const out = {
  label, sink: sink.split(':')[0], timestamp: new Date().toISOString(), requests: count, concurrency: conc,
  requestThroughputPerSec: +(count / ((tWorkloadEnd - tStart) / 1000)).toFixed(1), avgLatencyMs: run.summary.avgLatencyMs, p95LatencyMs: run.summary.p95LatencyMs,
  spansGenerated: generated, spansReceivedByCollector: received, spansExportedByCollector: exported, spansNotExported: Math.max(0, received - exported),
  spansRetainedPct: +(100 * exported / Math.max(1, received)).toFixed(1),
  spansInSink: sinkSpans, tracesInSink: sinkTraces, tracesSent: mine.size, errorTraceRetentionPct: errTraces.length ? +(100 * errKept / errTraces.length).toFixed(1) : null,
  batchSends: d(m1.collector?.batch.sends, m0.collector?.batch.sends), avgBatchSize: +(m1.collector?.batch.avgBatchSize ?? 0).toFixed(1),
  batchSizeTriggers: d(m1.collector?.batch.sizeTriggered, m0.collector?.batch.sizeTriggered), batchTimeoutTriggers: d(m1.collector?.batch.timeoutTriggered, m0.collector?.batch.timeoutTriggered),
  exportThroughputSpansPerSec: +(exported / Math.max(1, (tDrained - tStart) / 1000)).toFixed(1),
  pipelineDrainSecondsAfterWorkload: +Math.max(0, (tDrained - tWorkloadEnd) / 1000).toFixed(1),
  storageBytesAdded: bytesAdded, storageBytesPerRetainedSpan: sinkSpans ? Math.round(bytesAdded / sinkSpans) : null,
  collectorExportFailedSpans: d(m1.collector?.exportFailedSpans, m0.collector?.exportFailedSpans), sdkFailedSpans: d(m1.sdk.failedSpans, m0.sdk.failedSpans),
};
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `${label}.json`), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
