// Scrapes the Collector's own Prometheus endpoint (:8888) and extracts the numbers the lab needs.
// Metric names differ slightly between Collector versions (`_total` suffix), so matching is tolerant.
function parse(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{([^}]*)\})?\s+([-+0-9.eE]+|NaN|\+Inf)/);
    if (!m) continue;
    const labels = {};
    for (const l of (m[3] ?? '').matchAll(/(\w+)="((?:[^"\\]|\\.)*)"/g)) labels[l[1]] = l[2];
    rows.push({ name: m[1], labels, value: Number(m[4]) });
  }
  return rows;
}

const norm = (n) => n.replace(/_total$/, '');
const sum = (rows, name, filter = () => true) => rows.filter((r) => norm(r.name) === name && filter(r.labels)).reduce((a, r) => a + r.value, 0);

export function summarize(text) {
  const rows = parse(text);
  // Tail-sampling counters are PER POLICY and every policy evaluates every trace; a trace can match several policies,
  // so the per-policy "sampled" numbers must not be added up to get "retained traces".
  const byPolicy = {};
  for (const r of rows.filter((x) => norm(x.name) === 'otelcol_processor_tail_sampling_count_traces_sampled')) {
    const p = r.labels.policy ?? 'unknown';
    byPolicy[p] ??= { sampled: 0, notSampled: 0 };
    if (r.labels.sampled === 'true') byPolicy[p].sampled += r.value; else byPolicy[p].notSampled += r.value;
  }
  const evaluated = Object.values(byPolicy).map((p) => p.sampled + p.notSampled);
  const batchCount = sum(rows, 'otelcol_processor_batch_batch_send_size_count');
  const batchSum = sum(rows, 'otelcol_processor_batch_batch_send_size_sum');
  const received = sum(rows, 'otelcol_receiver_accepted_spans');
  const exported = sum(rows, 'otelcol_exporter_sent_spans');
  return {
    receivedSpans: received,
    refusedSpans: sum(rows, 'otelcol_receiver_refused_spans'),
    exportedSpans: exported,
    exportFailedSpans: sum(rows, 'otelcol_exporter_send_failed_spans'),
    // Only meaningful once the pipeline has drained (decision_wait + batch timeout after the last request).
    spansNotExported: Math.max(0, received - exported),
    tailSampling: {
      tracesEvaluated: evaluated.length ? Math.max(...evaluated) : 0,
      droppedTooEarly: sum(rows, 'otelcol_processor_tail_sampling_sampling_trace_dropped_too_early'),
      byPolicy,
    },
    batch: {
      sends: batchCount, avgBatchSize: batchCount ? batchSum / batchCount : 0,
      sizeTriggered: sum(rows, 'otelcol_processor_batch_batch_size_trigger_send'),
      timeoutTriggered: sum(rows, 'otelcol_processor_batch_timeout_trigger_send'),
    },
  };
}

export async function scrapeCollector(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!r.ok) throw new Error(`collector metrics HTTP ${r.status}`);
  return summarize(await r.text());
}
