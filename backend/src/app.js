// Gateway / API (port 4000): /health, /simulate, /faults, /traces, /telemetry, /pipeline, /archive.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import express from 'express';
import cors from 'cors';
import { mulberry32 } from './rng.js';
import { log } from './log.js';
import { createTelemetry } from './telemetry.js';
import { createServices, createFaultState } from './services.js';
import { createOpenSearch } from './opensearch.js';
import { createArchiver, ArchiveNotConfigured } from './archive.js';
import { scrapeCollector } from './collectorMetrics.js';

const ROLES = ['A', 'B', 'C'];
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function validateSimulate(b = {}) {
  const d = []; const p = {};
  const num = (k, def, min, max, int = false) => {
    const v = b[k] ?? def;
    if (!isNum(v) || v < min || v > max || (int && !Number.isInteger(v))) d.push(`${k} must be ${int ? 'an integer' : 'a number'} between ${min} and ${max}`);
    p[k] = v;
  };
  if (typeof b !== 'object' || b === null || Array.isArray(b)) return { errors: ['body must be a JSON object'] };
  num('count', 1, 1, 100000, true); num('concurrency', 5, 1, 100, true);
  num('errorRate', 0.1, 0, 1); num('slowRate', 0.1, 0, 1); num('slowExtraMs', 600, 0, 10000);
  num('baseLatencyMs', 40, 0, 5000); num('seed', Date.now() % 2147483647, 0, 4294967295, true);
  p.failService = b.failService ?? null;
  if (p.failService !== null && !ROLES.includes(p.failService)) d.push("failService must be one of 'A', 'B', 'C'");
  p.includeSpans = b.includeSpans;
  return { errors: d, params: p };
}

export function createApp(config, overrides = {}) {
  const telemetry = overrides.telemetry ?? createTelemetry(config);
  const faults = createFaultState();
  const services = createServices({ config, telemetry, faults });
  const opensearch = overrides.opensearch ?? createOpenSearch(config);
  const archiver = overrides.archiver ?? createArchiver({ config, opensearch });
  const recent = []; // newest last
  const counters = { requests: 0, ok: 0, failed: 0, runs: 0 };
  let inflight = 0; let shuttingDown = false; let apiServer;
  const startedAt = Date.now();

  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes('*') || config.corsOrigins.includes(origin)) }));
  app.use(express.json({ limit: '100kb' }));
  app.use((req, res, next) => { if (shuttingDown && req.path !== '/health') return res.status(503).json({ error: 'shutting_down' }); next(); });

  app.get('/health', (_req, res) => {
    const up = Object.fromEntries(ROLES.map((r) => [r, services.isUp(r) ? 'up' : 'down']));
    const degraded = Object.values(up).includes('down');
    res.status(shuttingDown ? 503 : 200).json({ status: shuttingDown ? 'shutting_down' : degraded ? 'degraded' : 'ok', uptimeSeconds: Math.round((Date.now() - startedAt) / 1000), services: up, otlpEndpoint: config.otlpEndpoint });
  });

  app.get('/config', (_req, res) => res.json({
    dashboardsUrl: config.dashboardsUrl, s3Configured: archiver.configured(), s3Bucket: config.s3.bucket || null, s3Prefix: config.s3.prefix,
    pipelineSettleMs: config.pipelineSettleMs, limits: config.limits,
  }));

  async function runOne(plan) {
    const t0 = Date.now(); inflight += 1;
    try {
      const r = await fetch(services.urlOf('A'), { method: 'POST', headers: { 'content-type': 'application/json', 'x-sim-plan': JSON.stringify(plan) }, body: '{}', signal: AbortSignal.timeout(config.serviceTimeoutMs * 3) });
      const data = await r.json().catch(() => ({}));
      return { traceId: data.traceId ?? null, status: r.ok ? 'ok' : 'error', httpStatus: r.status, durationMs: Date.now() - t0, startedAt: t0, failedService: data.failedService ?? null, error: data.error ?? null, spans: data.spans ?? [] };
    } catch (e) {
      return { traceId: null, status: 'error', httpStatus: 503, durationMs: Date.now() - t0, startedAt: t0, failedService: 'A', error: `service-a unreachable (${e?.cause?.code ?? e.name})`, spans: [] };
    } finally { inflight -= 1; }
  }

  app.post('/simulate', async (req, res) => {
    const { errors, params } = validateSimulate(req.body ?? {});
    if (errors.length) return res.status(400).json({ error: 'validation_failed', details: errors });
    if (params.count > config.limits.maxCount) return res.status(400).json({ error: 'validation_failed', details: [`count must be <= ${config.limits.maxCount} (MAX_REQUESTS_PER_SIMULATE)`] });
    const rng = mulberry32(params.seed);
    // Plans are generated up-front, in order, so a given seed always yields the same fault pattern.
    const plans = Array.from({ length: params.count }, () => {
      const plan = { baseLatencyMs: params.baseLatencyMs };
      if (rng() < params.errorRate) plan.failAt = params.failService ?? ROLES[Math.floor(rng() * 3)];
      if (rng() < params.slowRate) plan.slow = { service: ROLES[Math.floor(rng() * 3)], extraMs: params.slowExtraMs };
      return plan;
    });
    const runId = randomUUID(); const t0 = Date.now(); const results = new Array(params.count); let next = 0;
    await Promise.all(Array.from({ length: Math.min(params.concurrency, params.count) }, async () => {
      while (next < params.count) { const i = next++; results[i] = { index: i, ...(await runOne(plans[i])) }; }
    }));
    const dur = results.map((r) => r.durationMs).sort((a, b) => a - b);
    const ok = results.filter((r) => r.status === 'ok').length;
    counters.runs += 1; counters.requests += results.length; counters.ok += ok; counters.failed += results.length - ok;
    for (const r of results) if (r.traceId) { recent.push({ runId, traceId: r.traceId, status: r.status, startedAt: r.startedAt, endedAt: r.startedAt + r.durationMs, durationMs: r.durationMs, failedService: r.failedService, spanCount: r.spans.length }); }
    while (recent.length > 1000) recent.shift();
    const includeSpans = params.includeSpans ?? params.count <= 50;
    res.json({
      runId, params, summary: {
        requested: params.count, ok, failed: params.count - ok, durationMs: Date.now() - t0,
        avgLatencyMs: Math.round(dur.reduce((a, b) => a + b, 0) / dur.length), p95LatencyMs: dur[Math.ceil(0.95 * dur.length) - 1],
        spansEmitted: results.reduce((a, r) => a + r.spans.length, 0),
      },
      requests: results.map((r) => ({ index: r.index, traceId: r.traceId, status: r.status, httpStatus: r.httpStatus, durationMs: r.durationMs, failedService: r.failedService, error: r.error, spanCount: r.spans.length, ...(includeSpans ? { spans: r.spans } : {}) })),
    });
  });

  app.get('/traces/recent', (req, res) => {
    const limit = Math.min(Number.parseInt(req.query.limit ?? '50', 10) || 50, 500);
    res.json({ traces: recent.slice(-limit).reverse() });
  });

  // Does this trace exist in OpenSearch? (real lookup; the state is inferred only when it is absent)
  app.get('/telemetry/trace/:traceId', async (req, res) => {
    const { traceId } = req.params;
    if (!/^[0-9a-f]{32}$/.test(traceId)) return res.status(400).json({ error: 'traceId must be 32 hex characters' });
    const rec = recent.find((r) => r.traceId === traceId);
    try {
      const s = await opensearch.traceSummary(traceId);
      if (s.found) return res.json({ traceId, state: 'indexed', ...s });
      const age = rec ? Date.now() - rec.endedAt : null;
      if (age !== null && age < config.pipelineSettleMs) return res.json({ traceId, state: 'pending', note: 'Not in OpenSearch yet: may still be waiting for the tail-sampling decision, batching or indexing.', ageMs: age });
      return res.json({ traceId, state: 'not_indexed', inferred: true, note: 'Not found in OpenSearch. This is inferred, not observed: most likely the tail sampler dropped it (ordinary fast successful traces are sampled at a low %), or telemetry was lost. Indexing may also still be catching up.', ageMs: age });
    } catch (e) { res.status(502).json({ traceId, state: 'unknown', error: e.message }); }
  });

  app.get('/pipeline/metrics', async (_req, res) => {
    const sdk = { generated: telemetry.stats.generated, generatedTotal: Object.values(telemetry.stats.generated).reduce((a, b) => a + b, 0), exportedSpans: telemetry.stats.exportedSpans, failedSpans: telemetry.stats.failedSpans, exportOk: telemetry.stats.exportOk, exportFailed: telemetry.stats.exportFailed, lastError: telemetry.stats.lastError };
    const out = { sdk, requests: { ...counters }, collector: null, opensearch: null };
    try { out.collector = await scrapeCollector(config.collectorMetricsUrl); } catch (e) { out.collectorError = e.message; }
    const ping = await opensearch.ping(); out.opensearch = ping;
    if (ping.reachable) { try { out.opensearch.indexedSpans = await opensearch.countSpans(); } catch (e) { out.opensearch.countError = e.message; } }
    res.json(out);
  });

  app.get('/faults', (_req, res) => res.json({ faults, services: Object.fromEntries(ROLES.map((r) => [r, services.isUp(r) ? 'up' : 'down'])) }));
  app.post('/faults', (req, res) => {
    const { service, errorRate, extraLatencyMs } = req.body ?? {};
    const d = [];
    if (!ROLES.includes(service)) d.push("service must be one of 'A','B','C'");
    if (errorRate !== undefined && !(isNum(errorRate) && errorRate >= 0 && errorRate <= 1)) d.push('errorRate must be between 0 and 1');
    if (extraLatencyMs !== undefined && !(isNum(extraLatencyMs) && extraLatencyMs >= 0 && extraLatencyMs <= 30000)) d.push('extraLatencyMs must be between 0 and 30000');
    if (d.length) return res.status(400).json({ error: 'validation_failed', details: d });
    if (errorRate !== undefined) faults[service].errorRate = errorRate;
    if (extraLatencyMs !== undefined) faults[service].extraLatencyMs = extraLatencyMs;
    res.json({ faults });
  });
  app.delete('/faults', (_req, res) => { for (const r of ROLES) faults[r] = { errorRate: 0, extraLatencyMs: 0 }; res.json({ faults }); });
  app.post('/faults/:service/crash', async (req, res) => { if (!ROLES.includes(req.params.service)) return res.status(404).json({ error: 'unknown service' }); await services.crash(req.params.service); res.json({ service: req.params.service, state: 'down' }); });
  app.post('/faults/:service/recover', async (req, res) => { if (!ROLES.includes(req.params.service)) return res.status(404).json({ error: 'unknown service' }); await services.recover(req.params.service); res.json({ service: req.params.service, state: 'up' }); });

  app.post('/archive', async (req, res) => {
    const b = req.body ?? {};
    const sinceMs = b.sinceMinutes !== undefined ? Date.now() - Number(b.sinceMinutes) * 60000 : undefined;
    if (b.sinceMinutes !== undefined && !(Number(b.sinceMinutes) > 0)) return res.status(400).json({ error: 'validation_failed', details: ['sinceMinutes must be a positive number'] });
    if (b.traceIds !== undefined && !(Array.isArray(b.traceIds) && b.traceIds.every((t) => /^[0-9a-f]{32}$/.test(t)))) return res.status(400).json({ error: 'validation_failed', details: ['traceIds must be an array of 32-hex trace ids'] });
    try { res.json(await archiver.archive({ sinceMs, traceIds: b.traceIds })); }
    catch (e) {
      if (e instanceof ArchiveNotConfigured) return res.status(503).json({ error: 'archive_not_configured', message: 'Set S3_BUCKET (and AWS credentials/region) - see docs/AWS_SETUP.md' });
      log('error', 'archive failed', { message: e.message, name: e.name });
      res.status(502).json({ error: 'archive_failed', name: e.name, message: e.message });
    }
  });
  app.get('/archive/history', (_req, res) => res.json({ configured: archiver.configured(), archives: archiver.history() }));
  app.get('/archive/objects', async (_req, res) => {
    try { res.json({ objects: await archiver.list() }); }
    catch (e) { if (e instanceof ArchiveNotConfigured) return res.status(503).json({ error: 'archive_not_configured' }); res.status(502).json({ error: 'list_failed', message: e.message }); }
  });

  app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  app.use((err, _req, res, _next) => {
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' });
    log('error', 'unhandled', { message: err?.message }); res.status(500).json({ error: 'internal_error' });
  });

  return {
    app, telemetry, services, faults,
    async start() {
      await services.startAll();
      apiServer = http.createServer(app);
      await new Promise((resolve, reject) => { apiServer.once('error', reject); apiServer.listen(config.apiPort, config.host, resolve); });
      return apiServer.address().port;
    },
    async stop() {
      shuttingDown = true;
      const deadline = Date.now() + 10000;
      while (inflight > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
      if (apiServer) { apiServer.closeIdleConnections?.(); await new Promise((r) => apiServer.close(() => r())); }
      await services.stopAll();
      // Bounded: if the Collector is down, don't hang the container's stop for the whole export timeout.
      const bound = (p) => Promise.race([p, new Promise((r) => setTimeout(r, 5000))]);
      await bound(telemetry.forceFlush().catch(() => {}));
      await bound(telemetry.shutdown());
    },
  };
}
