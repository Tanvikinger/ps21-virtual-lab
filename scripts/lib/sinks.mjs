// Readers that return what ACTUALLY reached the end of the pipeline, as Map(traceId -> {spans, services, hasError}).
//  - opensearch:<url>  : spans indexed by Data Prepper (real indexing)
//  - file:<path>       : Collector `file` exporter output (sandbox/testing overlay, no OpenSearch needed)
import fs from 'node:fs';

const attrVal = (v) => v?.stringValue ?? v?.intValue ?? v?.boolValue ?? v?.doubleValue;

export async function readFileSink(path) {
  const traces = new Map();
  if (!fs.existsSync(path)) return traces;
  for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let doc; try { doc = JSON.parse(line); } catch { continue; }
    for (const rs of doc.resourceSpans ?? []) {
      const svc = attrVal((rs.resource?.attributes ?? []).find((a) => a.key === 'service.name')?.value);
      for (const ss of rs.scopeSpans ?? []) for (const sp of ss.spans ?? []) {
        const t = traces.get(sp.traceId) ?? { spans: new Map(), services: new Set(), hasError: false };
        t.spans.set(sp.spanId, sp); t.services.add(svc);
        if (sp.status?.code === 2 || sp.status?.code === 'STATUS_CODE_ERROR') t.hasError = true;
        traces.set(sp.traceId, t);
      }
    }
  }
  return traces;
}

export async function readOpenSearchSink(url, index = 'otel-v1-apm-span-*') {
  const traces = new Map(); let after;
  for (;;) {
    const r = await fetch(`${url}/${index}/_search?ignore_unavailable=true&allow_no_indices=true`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ size: 1000, sort: [{ startTime: 'asc' }, { spanId: 'asc' }], query: { match_all: {} }, ...(after ? { search_after: after } : {}) }),
    });
    if (!r.ok) throw new Error(`OpenSearch HTTP ${r.status}`);
    const hits = (await r.json()).hits?.hits ?? [];
    for (const h of hits) {
      const s = h._source; const t = traces.get(s.traceId) ?? { spans: new Map(), services: new Set(), hasError: false };
      t.spans.set(s.spanId, s); t.services.add(s.serviceName);
      if ((s.status?.code ?? s['status.code']) === 2) t.hasError = true;
      traces.set(s.traceId, t);
    }
    if (hits.length < 1000) break;
    after = hits[hits.length - 1].sort;
  }
  return traces;
}

export const readSink = (spec) => spec.startsWith('file:') ? readFileSink(spec.slice(5)) : readOpenSearchSink(spec.replace(/^opensearch:/, ''));
