// Central environment configuration. No secrets are hardcoded: AWS credentials come from the
// standard AWS SDK credential chain (env vars, shared config/SSO, or an IAM role).
const int = (v, d) => {
  if (v === undefined || v === '') return d;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

export function loadConfig(env = process.env) {
  return {
    host: env.HOST ?? '0.0.0.0', // API bind address (inside Docker must be 0.0.0.0)
    apiPort: int(env.API_PORT, 4000),
    serviceHost: env.SERVICE_HOST ?? '127.0.0.1', // internal A/B/C listeners stay on loopback
    servicePorts: { A: int(env.SERVICE_A_PORT, 4001), B: int(env.SERVICE_B_PORT, 4002), C: int(env.SERVICE_C_PORT, 4003) },
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173,https://ps21vlab.netlify.app')
      .split(',').map((s) => s.trim()).filter(Boolean),
    serviceTimeoutMs: int(env.SERVICE_TIMEOUT_MS, 5000),
    otlpEndpoint: (env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318').replace(/\/$/, ''),
    sdkBatch: {
      maxExportBatchSize: int(env.OTEL_BSP_MAX_EXPORT_BATCH_SIZE, 512),
      scheduledDelayMillis: int(env.OTEL_BSP_SCHEDULE_DELAY, 1000),
      maxQueueSize: int(env.OTEL_BSP_MAX_QUEUE_SIZE, 8192),
      exportTimeoutMillis: int(env.OTEL_BSP_EXPORT_TIMEOUT, 10000),
    },
    collectorMetricsUrl: env.COLLECTOR_METRICS_URL ?? 'http://localhost:8888/metrics',
    opensearchUrl: (env.OPENSEARCH_URL ?? 'http://localhost:9200').replace(/\/$/, ''),
    opensearchSpanIndex: env.OPENSEARCH_SPAN_INDEX ?? 'otel-v1-apm-span-*',
    dashboardsUrl: env.DASHBOARDS_URL ?? 'http://localhost:5601',
    // Used only to *infer* a status for traces that are not (yet) in OpenSearch.
    pipelineSettleMs: int(env.PIPELINE_SETTLE_MS, 20000),
    s3: {
      bucket: env.S3_BUCKET ?? '',
      prefix: (env.S3_PREFIX ?? 'telemetry/').replace(/^\/+/, ''),
      region: env.AWS_REGION ?? env.AWS_DEFAULT_REGION,
      endpoint: env.S3_ENDPOINT || undefined, // only for local S3-compatible test servers
      storageClass: env.S3_STORAGE_CLASS || undefined, // e.g. STANDARD_IA, GLACIER_IR
      maxSpansPerArchive: int(env.ARCHIVE_MAX_SPANS, 50000),
    },
    limits: { maxCount: int(env.MAX_REQUESTS_PER_SIMULATE, 2000), maxConcurrency: 100 },
  };
}
