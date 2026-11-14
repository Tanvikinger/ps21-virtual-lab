# Demo script (about 8 minutes) and viva Q&A

## Demo script
1. **Architecture** (docs/ARCHITECTURE.md diagram): frontend -> services A/B/C -> OTel SDK -> Collector (tail sampling, batch) -> Data Prepper -> OpenSearch -> Dashboards, plus S3 archive.
2. **Dashboard**: explain the pipeline stages and graphs.
3. **Traffic & Traces**: send 100 requests (20% errors). Open a trace: real spans, parent-child links. Then Dashboard (graphs), Fault Injection (crash Service B), AWS Cloud (archive to S3, CloudWatch metrics + alarm).
4. **Tail sampling**: wait ~20 s, click *Check pipeline status*: error traces *Indexed*, many ordinary ones *Not indexed (inferred)*. Show Pipeline metrics: received vs exported spans, per-policy counts.
5. **Dashboards** (http://localhost:5601 -> Trace analytics): search a trace ID, show service map.
6. **Fault injection**: crash Service B, send requests (errors, `ECONNREFUSED`), show the error traces are retained; recover.
7. **S3 archive**: click *Archive*, show `verified: true`, then `aws s3 ls`.
8. **Benchmarks**: show `benchmarks/results/SUMMARY.md` (sampling on vs off). State limitations (docs/LIMITATIONS.md).

## Viva questions
1. **What is distributed tracing?** Following one request across services using a shared trace ID; each unit of work is a span with a parent, timing and status.
2. **How does context propagate?** The caller injects the W3C `traceparent` header (trace ID + parent span ID); the callee extracts it and creates a child span. See `callNext` and the `extract` in `services.js`.
3. **Head vs tail sampling?** Head decides at the start (cheap, blind to errors). Tail decides after the whole trace is seen, so it can always keep errors and slow traces.
4. **Why must all spans of a trace reach one Collector?** The decision needs the complete trace; otherwise it decides on partial data. Scale-out needs routing by trace ID.
5. **What does `decision_wait` do and its trade-off?** Buffering time before deciding. Larger = more complete traces but more memory and delay (measured drain 12 s vs 2 s).
6. **What policies do you use?** ERROR status, latency >= 500 ms, 10% probabilistic; OR-ed.
7. **What does the batch processor do?** Groups spans into fewer, larger exports: better throughput, adds up to `timeout` latency.
8. **Why a memory_limiter?** Protects the Collector from OOM by refusing data under pressure.
9. **What is Data Prepper for?** Receives OTLP and writes trace-analytics-shaped documents/service map into OpenSearch.
10. **How is "indexed" proven, not faked?** The UI asks OpenSearch for the trace ID (`/telemetry/trace/:id`); absence is labelled *inferred*.
11. **Why S3 for cold storage?** Cheap, durable object storage; archives are gzip NDJSON, verified with HeadObject; lifecycle rules can tier/expire.
12. **How do you secure credentials?** None in code/Git; AWS SDK default credential chain, SSO/profile or IAM role; least-privilege policy; `.env` git-ignored.
13. **What happens if the Collector dies?** Measured: traces in the sampler's memory are lost; short outages are covered by SDK retry; long ones lose data (counted).
14. **What results did sampling give?** Measured: all error traces kept; ~25% of spans retained; ~60% less storage (file sink). Re-measured on OpenSearch by the benchmark script.
15. **Limitations?** Single node, in-memory sampler, local security disabled, S3 archive on demand, services simulated (see docs/LIMITATIONS.md).
16. **Why OTLP?** Vendor-neutral protocol; swap backends without changing instrumentation.
