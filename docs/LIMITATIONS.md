# Project limitations (be upfront about these in the viva)

1. **Single node, single Collector.** No high availability. Tail-sampling state is in memory and lost on restart (measured).
2. **Security is disabled for the local lab** (OpenSearch security plugin off, no TLS). Ports are bound to localhost only. Never expose them.
3. **Services are simulated workloads**, not real business services. Latency/errors are injected. But the HTTP calls, context propagation, spans and exports are real. All three services run in one Node process (three listeners), so they share a host.
4. **Per-trace sampling decision is not queryable.** The Collector exposes per-policy counters only; the "Not indexed (inferred)" status is an inference (absent after the settle time), not an observed decision.
5. **S3 archival is a backend workflow** (OpenSearch -> S3 on request), not automatic continuous archival or an OpenSearch snapshot repository. Verified against a local S3-compatible server; real-AWS verification is your step (`npm run verify:s3`).
6. **Archive reads back from OpenSearch**, so only retained (sampled) spans are archived. Capped by `ARCHIVE_MAX_SPANS` (50 000) per call.
7. **Benchmarks delivered** use a file exporter in a Linux sandbox, single run per scenario. OpenSearch-based numbers must be produced on your machine.
8. **Docker stack was not executed in the delivery environment** (no Docker there). Collector configs were validated and run with the real binary; compose/Data Prepper/OpenSearch files are syntax-checked only until you run them (see `docs/STATUS.md`).
9. **Image tags** (OpenSearch/Dashboards 2.19.7, Data Prepper 2.17.0) were chosen from upstream release tags but not pulled; if a tag is unavailable, change it in `.env`.
10. **CloudWatch** is documented (S3 metrics, alarm, EC2 metrics) but not integrated in code.
11. The deployed Netlify site is static HTTPS; real mode needs a backend on your own machine and a CORS-allowed origin (browser private-network prompts may appear).
12. OpenTelemetry JS SDK versions are pinned to a compatible set (SDK 2.12.0, exporter 0.223.0); upgrading one package alone breaks peer dependencies.
