# Status checklist (what was verified, and where)

Legend: **Verified here** = executed in the delivery environment with real binaries. **Needs you** = cannot run there; you run it on Windows/Docker/AWS.

| Item | State | Evidence |
|---|---|---|
| Frontend build, type-check, original 14 tests | Verified here | `npm run build`, `tsc --noEmit`, `npm test` |
| New frontend client tests (5) | Verified here | `tests/realApi.test.ts` |
| Real Telemetry page in a browser | **Needs you** | Compiles and builds; not rendered visually in a browser there |
| Backend: /health, /simulate, validation, CORS, seeds, shutdown | Verified here | 15 backend tests + real SIGTERM run (exit 0) |
| Real OTel spans: parent-child, 3 service names, trace IDs, exception recording | Verified here | OTLP/JSON captured on the wire by a test receiver |
| Collector config validity (3 files) | Verified here | `otelcol-contrib validate`, v0.165.0 |
| Tail sampling | Verified here | Real Collector: 77/77 error traces, 54/54 slow, ordinary 25/269 = 9.3%, no partial traces |
| Batch processor + metrics | Verified here | Collector metrics parsed by `/pipeline/metrics` |
| Benchmarks (sampling on/off x batch size) | Verified here, file sink | `benchmarks/results-sandbox/` |
| Fault tolerance (service crash, collector restart, 6 s/20 s outage) | Verified here, file sink | `docs/FAULT_TOLERANCE.md` |
| Archive code path (NDJSON/gzip, PutObject, HeadObject verify, list) | Verified here vs local S3 server | `backend/test/archive.test.mjs` |
| **Real AWS S3 upload / IAM** | **Needs you** | `npm run verify:s3` (docs/AWS_SETUP.md) |
| **Docker Compose stack start + health** | **Needs you** | `docker compose up -d --build` |
| **Data Prepper -> OpenSearch indexing, search, Dashboards** | **Needs you** | `node scripts/verify-pipeline.mjs --sink opensearch:...` |
| **OpenSearch benchmark numbers (indexing latency, index size)** | **Needs you** | `scripts/run-benchmarks.mjs` |
| CloudWatch | Documented only | `docs/AWS_SETUP.md` section 7 |
| Git commit / push / deploy | Not done (by your rule) | - |
| AWS account inspection | Not possible there (no credentials) | - |
