// Thin OpenSearch client (plain fetch, no extra dependency). Reads the span index written by Data Prepper.
export function createOpenSearch(config) {
  const base = config.opensearchUrl;
  const idx = config.opensearchSpanIndex;
  const q = 'ignore_unavailable=true&allow_no_indices=true';

  async function req(path, { method = 'GET', body } = {}) {
    const r = await fetch(`${base}${path}`, {
      method, headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`OpenSearch ${method} ${path.split('?')[0]} -> HTTP ${r.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : {};
  }

  const statusCode = (src) => src?.status?.code ?? src?.['status.code'] ?? 0;

  return {
    async ping() {
      try { const j = await req('/_cluster/health'); return { reachable: true, clusterStatus: j.status }; }
      catch (e) { return { reachable: false, error: e.message }; }
    },
    /** Spans of one trace as actually stored in OpenSearch. */
    async traceSummary(traceId) {
      const j = await req(`/${idx}/_search?${q}`, { method: 'POST', body: { size: 200, query: { term: { traceId } }, _source: ['serviceName', 'spanId', 'parentSpanId', 'name', 'status', 'durationInNanos'] } });
      const hits = (j.hits?.hits ?? []).map((h) => h._source);
      return {
        found: hits.length > 0, spanCount: hits.length,
        services: [...new Set(hits.map((h) => h.serviceName))].sort(),
        hasError: hits.some((h) => statusCode(h) === 2),
      };
    },
    async countSpans(query = { match_all: {} }) {
      const j = await req(`/${idx}/_count?${q}`, { method: 'POST', body: { query } });
      return j.count ?? 0;
    },
    /** Pages through spans with search_after. `sinceMs`/`traceIds` narrow the selection. */
    async fetchSpans({ sinceMs, untilMs, traceIds, limit }) {
      const must = [];
      if (sinceMs || untilMs) must.push({ range: { startTime: { ...(sinceMs ? { gte: new Date(sinceMs).toISOString() } : {}), ...(untilMs ? { lte: new Date(untilMs).toISOString() } : {}) } } });
      if (traceIds?.length) must.push({ terms: { traceId: traceIds } });
      const out = []; let after;
      while (out.length < limit) {
        const j = await req(`/${idx}/_search?${q}`, { method: 'POST', body: {
          size: Math.min(1000, limit - out.length), query: { bool: { must } },
          sort: [{ startTime: 'asc' }, { spanId: 'asc' }], ...(after ? { search_after: after } : {}),
        } });
        const hits = j.hits?.hits ?? [];
        if (!hits.length) break;
        for (const h of hits) out.push(h._source);
        after = hits[hits.length - 1].sort;
        if (hits.length < 1000) break;
      }
      return out;
    },
  };
}
