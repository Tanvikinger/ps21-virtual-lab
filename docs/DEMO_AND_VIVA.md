# Demo script (about 8 minutes) and viva Q&A

## Demo script
1. **Architecture** (docs/ARCHITECTURE.md diagram): frontend -> services A/B/C -> OTel SDK -> Collector (tail sampling, batch) -> Data Prepper -> OpenSearch -> Dashboards, plus S3 archive.
2. **Simulator** (existing pages): show the educational simulation and say clearly it is a model.
3. **Real Telemetry page**: show *Connected*, send 100 requests (20% errors). Open a trace: real spans, parent-child links.
4. **Tail sampling**: wait ~20 s, click *Check pipeline status*: error traces *Indexed*, many ordinary ones *Not indexed (inferred)*. Show Pipeline metrics: received vs exported spans, per-policy counts.
5. **Dashboards** (http://localhost:5601 -> Trace analytics): search a trace ID, show service map.
6. **Fault injection**: crash Service B, send requests (errors, `ECONNREFUSED`), show the error traces are retained; recover.
7. **S3 archive**: click *Archive*, show `verified: true`, then `aws s3 ls`.
8. **Benchmarks**: show `benchmarks/results/SUMMARY.md` (sampling on vs off). State limitations (docs/LIMITATIONS.md).
