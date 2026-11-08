import type { ReactNode } from 'react';

const C: { t: string; b: string; ex?: ReactNode }[] = [
  { t: 'Distributed tracing', b: 'A request in a microservice system touches several services. Tracing records that journey so you can see where time went and where it failed.', ex: <code>User → A → B → C</code> },
  { t: 'Trace IDs', b: 'A unique identifier (here 32 hex characters) shared by every span of one request. It is the key that stitches the pieces together.', ex: <code>4bf92f35…a2c1 appears on spans A, B and C</code> },
  { t: 'Spans', b: 'One unit of work inside a trace, with a service, a start time, a duration and a status (OK or Error). A trace is a tree of spans.' },
  { t: 'Parent-child relationships', b: 'When A calls B, B’s span is a child of A’s span, and C’s is a child of B’s. This is what the waterfall shows as nested bars.', ex: <pre className="text-[11px]">{`A ████████████\n  B   ████████\n    C   ████`}</pre> },
  { t: 'Context propagation', b: 'The trace ID and parent span ID travel with each call (e.g. in an HTTP header) so the next service can attach its span to the same trace. In the lab this is the “call + trace context” arrow.' },
  { t: 'OpenTelemetry', b: 'An open standard and toolkit for producing and collecting traces, metrics and logs. The Collector receives telemetry, processes it (sampling, batching) and exports it. This lab only models those ideas - it does not run a real Collector.' },
  { t: 'Tail-based sampling', b: 'Tail sampling waits for enough information about a trace before deciding whether to keep it. This allows the system to retain important traces, such as errors and unusually slow requests. The cost: traces must be held in memory while waiting (the “pending” buffer).' },
  { t: 'Batch processing', b: 'Telemetry is grouped into batches before export. Big batches mean fewer exports (efficient) but records wait longer; small batches are faster to leave but cost more per record.' },
  { t: 'Queueing and backpressure', b: 'When data arrives faster than a stage can process it, a queue builds. A full queue forces the system to drop or delay data - this is backpressure. Watch the queue-depth chart in the Collector Bottleneck experiment.' },
  { t: 'Trace indexing', b: 'A search engine (OpenSearch in this project) indexes traces so you can look them up by ID, service or status. A trace is searchable only after indexing succeeds.' },
  { t: 'Cold object storage', b: 'Cheap, durable storage (like S3) for long-term retention. Data is written as objects and is not meant for fast search. Indexing supports searching; cold storage supports archival retention.' },
  { t: 'Fault injection', b: 'Deliberately breaking a component to see how the system behaves. Use the Fault Injection Lab to take down Service B, the index or cold storage, then remove the fault and observe recovery.' },
  { t: 'Latency percentiles', b: 'p95 latency is the value below which 95% of requests finish. Averages hide slow outliers; percentiles expose them. Here p95 uses the nearest-rank method: sort the durations and take the value at rank ⌈0.95 × n⌉.' },
  { t: 'Recovery and reliability', b: 'A reliable system keeps working or recovers after faults. In this lab, retries and buffers recover short outages, but anything beyond the configured limits is lost - and requests that failed on the request path are not retried.' },
];

export function LearnPage() {
  return (
    <div className="space-y-3">
      <div><h1 className="text-lg font-semibold text-indigo-950">Learn the Concepts</h1><p className="text-xs text-slate-600">Short explanations of every idea used in the lab - useful for viva preparation.</p></div>
      <div className="panel text-xs"><b>Two separate flows:</b> the <span className="font-semibold text-indigo-700">application request</span> travels Traffic → A → B → C; the <span className="font-semibold text-violet-700">telemetry</span> describing that request travels Services → Collector → Tail Sampling → Batch → Exporter → OpenSearch, and eligible data continues → Archival Worker → Cold Object Storage.</div>
      <div className="grid gap-3 md:grid-cols-2">{C.map((c) => <div key={c.t} className="panel"><h3 className="text-sm font-semibold text-indigo-950">{c.t}</h3><p className="mt-1 text-xs text-slate-700">{c.b}</p>{c.ex && <div className="mt-1 rounded bg-slate-50 p-1.5 text-xs text-slate-600">{c.ex}</div>}</div>)}</div>
      <div className="panel text-xs text-slate-600"><b>About this simulator:</b> it is a deterministic discrete-event model running in your browser. It does not run a real OpenTelemetry Collector, OpenSearch, or any cloud storage, and its numbers illustrate behaviour rather than predict production performance.</div>
    </div>
  );
}
