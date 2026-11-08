// Runs the benchmark matrix: for each scenario it (re)starts the Collector with that config/batch size, then runs benchmark.mjs.
//   node scripts/run-benchmarks.mjs --sink opensearch:http://localhost:9200
// Default restart command (Docker Compose) reads COLLECTOR_CONFIG and BATCH_SIZE from the environment.
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const sink = arg('sink', 'opensearch:http://localhost:9200'); const count = arg('count', '2000'); const outDir = arg('out', 'benchmarks/results');
const restart = arg('restart-cmd', 'docker compose up -d --force-recreate --no-deps otel-collector');
const settle = Number(arg('settle', 8)); const timeout = arg('batch-timeout', '1s'); const decisionWait = arg('decision-wait', '10s');
const full = process.argv.includes('--full');
const sizes = (arg('sizes', '16,128,512,2048')).split(',').map(Number);
const scenarios = full
  ? [false, true].flatMap((s) => sizes.map((b) => ({ sampling: s, batch: b })))
  : [{ sampling: false, batch: 512 }, ...sizes.map((b) => ({ sampling: true, batch: b }))];
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

fs.mkdirSync(outDir, { recursive: true }); const results = [];
for (const sc of scenarios) {
  const label = `sampling-${sc.sampling ? 'on' : 'off'}-batch-${sc.batch}`;
  console.log(`\n=== ${label} ===`);
  const env = { ...process.env, COLLECTOR_CONFIG: sc.sampling ? 'otel-collector-config.yaml' : 'otel-collector-nosampling.yaml', BATCH_SIZE: String(sc.batch), BATCH_TIMEOUT: timeout, TAIL_DECISION_WAIT: decisionWait };
  execSync(restart, { stdio: 'inherit', env, shell: true });
  await sleep(settle);
  execSync(`node scripts/benchmark.mjs --label ${label} --count ${count} --sink "${sink}" --out ${outDir}`, { stdio: ['ignore', 'pipe', 'inherit'], env });
  results.push(JSON.parse(fs.readFileSync(`${outDir}/${label}.json`, 'utf8')));
}
const base = results.find((r) => r.label.startsWith('sampling-off'));
const rows = results.map((r) => `| ${r.label.startsWith('sampling-on') ? 'on' : 'off'} | ${r.label.split('-').pop()} | ${r.spansGenerated} | ${r.spansExportedByCollector} | ${r.spansNotExported} | ${r.spansRetainedPct}% | ${r.errorTraceRetentionPct ?? 'n/a'}% | ${r.exportThroughputSpansPerSec} | ${r.avgBatchSize} | ${r.pipelineDrainSecondsAfterWorkload}s | ${r.storageBytesAdded} | ${base && base !== r ? (100 * (1 - r.storageBytesAdded / Math.max(1, base.storageBytesAdded))).toFixed(1) + '%' : '-'} |`);
const md = `# Benchmark results (measured ${new Date().toISOString()}, sink: ${sink.split(':')[0]}, ${count} requests/scenario)\n\n| Sampling | Batch size | Spans generated | Spans exported (retained) | Spans dropped | Retained | Error-trace retention | Export spans/s | Avg batch | Drain after workload | Storage bytes added | Storage reduction vs off |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`;
fs.writeFileSync(`${outDir}/SUMMARY.md`, md); console.log('\n' + md);
