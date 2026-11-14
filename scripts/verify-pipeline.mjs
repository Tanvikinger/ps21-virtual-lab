// End-to-end check of the tail-sampling pipeline using the sink that is actually reachable.
//   node scripts/verify-pipeline.mjs --sink opensearch:http://localhost:9200
//   node scripts/verify-pipeline.mjs --sink file:/tmp/traceflow-traces.jsonl      (sandbox overlay)
// It sends a seeded workload, waits for the tail-sampling window, then asserts on what was really stored.
import { readSink } from './lib/sinks.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const api = arg('api', 'http://localhost:4000');
const sink = arg('sink', 'opensearch:http://localhost:9200');
const count = Number(arg('count', 300));
const waitS = Number(arg('wait', 90)); // must exceed decision_wait + batch timeout + indexing
const spansPerTrace = 5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const res = await fetch(`${api}/simulate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ count, concurrency: 20, errorRate: 0.2, slowRate: 0.2, slowExtraMs: 700, seed: 42, includeSpans: false }) });
if (!res.ok) { console.error('simulate failed', res.status, await res.text()); process.exit(2); }
const run = await res.json();
const ok = run.requests.filter((r) => r.status === 'ok'); const err = run.requests.filter((r) => r.status === 'error' && r.traceId);
const slowOk = ok.filter((r) => r.durationMs >= 500); const ordinary = ok.filter((r) => r.durationMs < 500);
console.log(`sent ${count}: ${err.length} error traces, ${slowOk.length} slow ok traces, ${ordinary.length} ordinary traces; waiting ${waitS}s for sampling/batch/indexing...`);
await sleep(waitS * 1000);

const stored = await readSink(sink);
const present = (list) => list.filter((r) => stored.has(r.traceId)).length;
const complete = (list) => list.filter((r) => stored.get(r.traceId)?.spans.size >= (r.spanCount ?? spansPerTrace)).length;
const checks = [];
const check = (name, pass, detail) => { checks.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); };

check('all ERROR traces retained', present(err) === err.length, `${present(err)}/${err.length}`);
check('retained ERROR traces are complete (whole trace kept)', complete(err) === present(err), `${complete(err)}/${present(err)} complete`);
check('slow traces retained (>=500ms)', present(slowOk) >= slowOk.length * 0.95, `${present(slowOk)}/${slowOk.length}`);
const pct = ordinary.length ? (100 * present(ordinary)) / ordinary.length : 0;
check('ordinary traces sampled well below 100% (target ~10%)', ordinary.length === 0 || (pct > 0 && pct < 35), `${present(ordinary)}/${ordinary.length} = ${pct.toFixed(1)}%`);
check('every stored trace is complete (all spans reached the same decision)', [...stored.entries()].filter(([id]) => run.requests.some((r) => r.traceId === id)).every(([id, t]) => t.spans.size >= run.requests.find((r) => r.traceId === id).spanCount), 'no partial traces');
const myIds = new Set(run.requests.map((r) => r.traceId));
const storedMine = [...stored.keys()].filter((id) => myIds.has(id)).length;
console.log(`\nretained ${storedMine}/${run.requests.length} traces (${(100 * storedMine / run.requests.length).toFixed(1)}%), dropped ${run.requests.length - storedMine}`);
process.exit(checks.every(Boolean) ? 0 : 1);
