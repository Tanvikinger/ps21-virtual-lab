// Service A -> B -> C. Three real HTTP servers (loopback). A starts the trace; B and C continue it via the
// W3C `traceparent` header, so context propagation is real, not simulated.
import http from 'node:http';
import express from 'express';
import { context, propagation, trace, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { SERVICE_NAMES } from './telemetry.js';

const NEXT = { A: 'B', B: 'C', C: null };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class FaultError extends Error {
  constructor(message, service) { super(message); this.name = 'InjectedFault'; this.service = service; }
}
class DownstreamError extends Error {
  constructor(message, service, httpStatus) { super(message); this.name = 'DownstreamError'; this.service = service; this.httpStatus = httpStatus; }
}

export function createFaultState() {
  const s = { A: { errorRate: 0, extraLatencyMs: 0 }, B: { errorRate: 0, extraLatencyMs: 0 }, C: { errorRate: 0, extraLatencyMs: 0 } };
  return s;
}

function parsePlan(h) {
  try { return h ? JSON.parse(h) : {}; } catch { return {}; }
}

export function createServices({ config, telemetry, faults }) {
  const servers = {};
  const sockets = { A: new Set(), B: new Set(), C: new Set() };
  const urlOf = (role) => `http://${config.serviceHost}:${config.servicePorts[role]}/process`;

  function buildApp(role) {
    const app = express();
    app.disable('x-powered-by');
    app.post('/process', async (req, res) => {
      const tracer = telemetry.tracers[role];
      const parentCtx = propagation.extract(context.active(), req.headers); // <- context propagation (server side)
      const parentSpanId = trace.getSpanContext(parentCtx)?.spanId ?? null;
      const plan = parsePlan(req.headers['x-sim-plan']);
      const next = NEXT[role];
      const startMs = Date.now();
      const spanRecs = [];

      await tracer.startActiveSpan(`${SERVICE_NAMES[role]} handle request`, {
        kind: SpanKind.SERVER,
        attributes: { 'http.request.method': 'POST', 'url.path': '/process', 'server.port': config.servicePorts[role] },
      }, parentCtx, async (span) => {
        let status = 200; let body = { ok: true }; let error = null; let origin = false; let failedService = null;
        try {
          const f = faults[role];
          let work = (plan.baseLatencyMs ?? 40) * (0.8 + Math.random() * 0.4) + (f.extraLatencyMs || 0);
          if (plan.slow && plan.slow.service === role) work += plan.slow.extraMs;
          work = Math.round(work);
          span.setAttribute('sim.work_ms', work);
          if (plan.slow?.service === role) span.setAttribute('sim.injected_slowness', true);
          await sleep(work);

          if (plan.failAt === role || Math.random() < f.errorRate) {
            span.setAttribute('sim.injected_fault', true);
            origin = true;
            throw new FaultError(`Injected failure in ${SERVICE_NAMES[role]}`, role);
          }
          if (next) await callNext(role, next, tracer, plan, spanRecs);
          span.setAttribute('http.response.status_code', 200);
        } catch (err) {
          status = err instanceof DownstreamError ? 502 : 500;
          error = err.message;
          failedService = err.service ?? role;
          span.setAttribute('http.response.status_code', status);
          span.recordException(err);
          span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
          body = { ok: false, failedService, error };
        }
        const endMs = Date.now();
        const sc = span.spanContext();
        span.end();
        spanRecs.unshift({
          service: SERVICE_NAMES[role], spanId: sc.spanId, parentSpanId, kind: 'SERVER', name: `${SERVICE_NAMES[role]} handle request`,
          startMs, durationMs: endMs - startMs, status: error ? 'error' : 'ok', ...(error ? { error } : {}), ...(origin ? { origin: true } : {}),
        });
        res.status(status).json({ ...body, traceId: sc.traceId, spans: spanRecs });
      });
    });
    return app;
  }

  async function callNext(role, next, tracer, plan, spanRecs) {
    const serverSpan = trace.getActiveSpan();
    const parentSpanId = serverSpan?.spanContext().spanId ?? null;
    const startMs = Date.now();
    const url = urlOf(next);
    const clientSpan = tracer.startSpan(`${SERVICE_NAMES[role]} -> ${SERVICE_NAMES[next]}`, {
      kind: SpanKind.CLIENT,
      attributes: { 'http.request.method': 'POST', 'url.full': url, 'peer.service': SERVICE_NAMES[next] },
    }, context.active());
    const ctx = trace.setSpan(context.active(), clientSpan);
    const headers = { 'content-type': 'application/json', 'x-sim-plan': JSON.stringify(plan) };
    propagation.inject(ctx, headers); // <- context propagation (client side): adds `traceparent`
    let error = null; let failure = null;
    try {
      let r;
      try {
        r = await fetch(url, { method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(config.serviceTimeoutMs) });
      } catch (e) {
        const reason = e?.cause?.code ?? e?.name ?? 'network error';
        throw new DownstreamError(`${SERVICE_NAMES[next]} unreachable (${reason})`, next, 503);
      }
      clientSpan.setAttribute('http.response.status_code', r.status);
      const data = await r.json().catch(() => ({}));
      if (Array.isArray(data.spans)) spanRecs.push(...data.spans);
      if (!r.ok) throw new DownstreamError(`Downstream ${SERVICE_NAMES[next]} failed: ${data.error ?? `HTTP ${r.status}`}`, data.failedService ?? next, r.status);
    } catch (err) {
      failure = err; error = err.message;
      clientSpan.recordException(err);
      clientSpan.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    }
    const endMs = Date.now();
    clientSpan.end();
    spanRecs.push({
      service: SERVICE_NAMES[role], spanId: clientSpan.spanContext().spanId, parentSpanId, kind: 'CLIENT', name: `${SERVICE_NAMES[role]} -> ${SERVICE_NAMES[next]}`,
      startMs, durationMs: endMs - startMs, status: error ? 'error' : 'ok', ...(error ? { error } : {}),
    });
    if (failure) throw failure;
  }

  function listen(role) {
    return new Promise((resolve, reject) => {
      const srv = http.createServer(buildApp(role));
      srv.on('connection', (s) => { sockets[role].add(s); s.on('close', () => sockets[role].delete(s)); });
      srv.once('error', reject);
      srv.listen(config.servicePorts[role], config.serviceHost, () => { servers[role] = srv; resolve(); });
    });
  }
  function close(role) {
    const srv = servers[role];
    if (!srv) return Promise.resolve();
    delete servers[role];
    for (const s of sockets[role]) s.destroy(); // a crash drops in-flight connections too
    return new Promise((resolve) => srv.close(() => resolve()));
  }

  return {
    async startAll() { for (const r of ['A', 'B', 'C']) await listen(r); },
    async stopAll() { for (const r of ['A', 'B', 'C']) await close(r); },
    crash: (role) => close(role),
    recover: async (role) => { if (!servers[role]) await listen(role); },
    isUp: (role) => Boolean(servers[role]),
    urlOf,
  };
}
