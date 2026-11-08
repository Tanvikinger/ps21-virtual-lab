# Benchmarks

Reproducible: every number is read from the Collector's metrics, the backend SDK counters and the sink that received the data. Nothing is estimated. Workload: seeded (`seed 42`), 10% injected errors, 10% slow requests (+700 ms), 50 concurrent clients.

## Run them on your stack (OpenSearch sink)
```powershell
node scripts/run-benchmarks.mjs --sink opensearch:http://localhost:9200 --count 2000
# results: benchmarks/results/*.json and benchmarks/results/SUMMARY.md
```
It restarts the Collector per scenario (`docker compose up -d --force-recreate --no-deps otel-collector`) using `COLLECTOR_CONFIG` (sampling on/off) and `BATCH_SIZE`. `--full` runs the full on/off x batch matrix. A single scenario: `node scripts/benchmark.mjs --label x --sink opensearch:http://localhost:9200`.

## Measured results delivered with the project (sandbox run, NOT your OpenSearch)
Environment: Linux sandbox, real `otelcol-contrib 0.165.0`, real backend, **Collector `file` exporter instead of Data Prepper/OpenSearch** (OpenSearch cannot run in that environment). 1500 requests per scenario, `BATCH_TIMEOUT=1s`, `decision_wait=10s`. Raw JSON: `benchmarks/results-sandbox/`.

| off | 512 | 7226 | 7226 | 0 | 100% | 100% | 602.8 | 516.1 | 2.1s | 4257791 | - |
| on | 16 | 7226 | 1766 | 5460 | 24.4% | 100% | 87.4 | 17.8 | 12.1s | 1647121 | 61.3% |
| on | 128 | 7226 | 1791 | 5435 | 24.8% | 100% | 87.3 | 119.4 | 12.1s | 1662786 | 60.9% |
| on | 512 | 7226 | 1846 | 5380 | 25.5% | 100% | 87.4 | 184.6 | 12.1s | 1702346 | 60.0% |
| on | 2048 | 7226 | 1841 | 5385 | 25.5% | 100% | 89.2 | 204.6 | 12.1s | 1698910 | 60.1% |

### How to read this (honest interpretation)
- **Storage reduction (~60%)** is measured on OTLP-JSON bytes written by the file exporter. In OpenSearch the absolute bytes differ (index overhead, replicas); re-run on your stack for those numbers. The *spans retained* and *error retention* columns do not depend on the sink.
- **Error-trace retention is 100%** in every sampling-on run: sampling removes ordinary traffic, not the traces you debug with.
- **Retained ~25% of spans** = all error traces + all slow traces + ~10% of the rest. It varies slightly run to run (24.4-25.5%) because the probabilistic policy hashes random trace IDs.
- **Export spans/s for sampling-on is low (~87) by design**: every trace waits `decision_wait` (10 s) before it can be exported, and the figure divides by total time including that wait. It measures *latency added by tail sampling*, not Collector capacity. "Drain after workload" (12.1 s vs 2.1 s) shows the same cost.
- **Batch size barely changes retention or storage.** It changes how exports are grouped: average batch size rose from 17.8 (limit 16) to 119 (128) to ~185-205 (512/2048). With sampling on, spans are released in bursts when decision timers fire, so the 512/2048 limits are never reached (all sends were timeout-triggered). In the sampling-off run, batches reached the size limit (avg 516).
- Indexing latency into OpenSearch is **not measured in the delivered results** (no OpenSearch there). The run on your stack records `pipelineDrainSecondsAfterWorkload` and `spansInSink` against OpenSearch.
- Single run per scenario, single machine: treat as indicative, not statistically rigorous. Repeat 3x for a report.
