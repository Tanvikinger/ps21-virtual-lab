// Fault-tolerance demonstrations. Reports MEASURED outcomes (never assumed).
//   node scripts/fault-demo.mjs service-crash     --sink opensearch:http://localhost:9200
//   node scripts/fault-demo.mjs collector-restart --sink opensearch:http://localhost:9200
// collector-restart runs `docker compose stop/start otel-collector` by default (override: --stop-cmd / --start-cmd).
import { execSync } from 'node:child_process';
import { readSink } from './lib/sinks.mjs';

const mode = process.argv[2];
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const api = arg('api', 'http://localhost:4000'); const sink = arg('sink', 'opensearch:http://localhost:9200');
const waitS = Number(arg('wait', 90)); const downS = Number(arg('down-seconds', 6)); const n = Number(arg('count', 40));
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const post = async (p, b = {}) => { const r = await fetch(api + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return r.json(); };
const sim = (extra = {}) => post('/simulate', { count: n, concurrency: 10, errorRate: 0, slowRate: 0, baseLatencyMs: 20, includeSpans: false, ...extra });
const retained = (stored, run) => run.requests.filter((r) => r.traceId && stored.has(r.traceId) && stored.get(r.traceId).spans.size >= r.spanCount).length;
const sdk = async () => (await (await fetch(`${api}/pipeline/metrics`)).json()).sdk;
const line = (label, a, b) => console.log(`${label.padEnd(58)} ${a}/${b}`);

if (mode === 'service-crash') {
  const before = await sim();
  await post('/faults/B/crash');
  const during = await sim();
  await post('/faults/B/recover');
  const after = await sim();
  await sleep(waitS);
  const stored = await readSink(sink);
  console.log('\n== Service B crash / recovery (real listener closed, real ECONNREFUSED) ==');
  console.log(`requests while B down: ok=${during.summary.ok} failed=${during.summary.failed}; first error: "${during.requests[0].error}"`);
  line('traces BEFORE crash retained (ordinary, ~10% expected)', retained(stored, before), n);
  line('traces DURING crash retained (all are errors => 100%)', retained(stored, during), n);
  line('traces AFTER recovery: requests ok', after.summary.ok, n);
  line('traces AFTER recovery retained (ordinary, ~10% expected)', retained(stored, after), n);
} else if (mode === 'collector-restart') {
  const stopCmd = arg('stop-cmd', 'docker compose stop otel-collector'); const startCmd = arg('start-cmd', 'docker compose start otel-collector');
  const s0 = await sdk();
  const b1 = await sim({ errorRate: 1, failService: 'C' });          // error traces, collector then dies INSIDE the decision window
  execSync(stopCmd, { stdio: 'inherit', shell: true }); console.log('collector stopped');
  const b2 = await sim({ errorRate: 1, failService: 'C' });          // sent while collector is down
  await sleep(downS);
  const mid = await sdk();
  execSync(startCmd, { stdio: 'inherit', shell: true }); await sleep(4); console.log('collector started');
  const b3 = await sim({ errorRate: 1, failService: 'C' });          // sent after restart
  await sleep(waitS);
  const stored = await readSink(sink); const s1 = await sdk();
  console.log('\n== Collector restart (all traces are errors, so sampling would keep every one) ==');
  line('batch 1: sent just BEFORE collector stopped, retained', retained(stored, b1), n);
  line(`batch 2: sent WHILE collector was down (${downS}s outage), retained`, retained(stored, b2), n);
  line('batch 3: sent AFTER collector restarted, retained', retained(stored, b3), n);
  console.log(`SDK-side: failed-to-export spans while down = ${mid.failedSpans - s0.failedSpans}; total failed ${s1.failedSpans - s0.failedSpans}; last error: ${s1.lastError}`);
} else {
  console.error('usage: fault-demo.mjs service-crash | collector-restart  [--sink ...] [--api ...]'); process.exit(2);
}
