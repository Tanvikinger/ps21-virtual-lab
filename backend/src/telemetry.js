// Real OpenTelemetry instrumentation. One TracerProvider per logical service so every span carries the
// correct `service.name`; all three export over OTLP/HTTP to the Collector.
// Initialisation order matters: the global context manager + W3C propagator are registered FIRST
// (provider A .register()), before any span is created, otherwise context would not flow across `await`.
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { ExportResultCode } from '@opentelemetry/core';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { NodeTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

let globalsRegistered = false; // context manager/propagator are process-wide: register once

export const SERVICE_NAMES = { A: 'service-a', B: 'service-b', C: 'service-c' };

class CountingExporter {
  constructor(inner, stats) { this.inner = inner; this.stats = stats; }
  export(spans, cb) {
    this.inner.export(spans, (result) => {
      if (result.code === ExportResultCode.SUCCESS) { this.stats.exportedSpans += spans.length; this.stats.exportOk += 1; }
      else { this.stats.failedSpans += spans.length; this.stats.exportFailed += 1; this.stats.lastError = result.error?.message ?? 'export failed'; }
      cb(result);
    });
  }
  shutdown() { return this.inner.shutdown(); }
  forceFlush() { return this.inner.forceFlush ? this.inner.forceFlush() : Promise.resolve(); }
}

class CountingProcessor {
  constructor(role, stats) { this.role = role; this.stats = stats; }
  onStart() {}
  onEnd() { this.stats.generated[this.role] += 1; }
  forceFlush() { return Promise.resolve(); }
  shutdown() { return Promise.resolve(); }
}

export function createTelemetry(config, env = process.env) {
  const level = { debug: DiagLogLevel.DEBUG, info: DiagLogLevel.INFO, warn: DiagLogLevel.WARN, error: DiagLogLevel.ERROR }[(env.OTEL_LOG_LEVEL ?? 'error').toLowerCase()] ?? DiagLogLevel.ERROR;
  diag.setLogger(new DiagConsoleLogger(), level);

  const stats = { generated: { A: 0, B: 0, C: 0 }, exportedSpans: 0, failedSpans: 0, exportOk: 0, exportFailed: 0, lastError: null };
  const providers = {};
  for (const role of ['A', 'B', 'C']) {
    const exporter = new CountingExporter(new OTLPTraceExporter({ url: `${config.otlpEndpoint}/v1/traces`, timeoutMillis: config.sdkBatch.exportTimeoutMillis }), stats);
    providers[role] = new NodeTracerProvider({
      resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: SERVICE_NAMES[role], 'service.namespace': 'traceflow', 'deployment.environment.name': env.DEPLOY_ENV ?? 'local' }),
      spanProcessors: [new CountingProcessor(role, stats), new BatchSpanProcessor(exporter, config.sdkBatch)],
    });
  }
  if (!globalsRegistered) { providers.A.register(); globalsRegistered = true; } // installs AsyncLocalStorage context manager + W3C trace-context propagator globally
  const tracers = Object.fromEntries(Object.entries(providers).map(([r, p]) => [r, p.getTracer(`traceflow.${SERVICE_NAMES[r]}`, '1.0.0')]));

  return {
    tracers, stats,
    async forceFlush() { await Promise.all(Object.values(providers).map((p) => p.forceFlush())); },
    async shutdown() { await Promise.allSettled(Object.values(providers).map((p) => p.shutdown())); },
  };
}
