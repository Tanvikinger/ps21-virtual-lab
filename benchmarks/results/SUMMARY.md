# Benchmark results (measured 2026-11-08T06:50:11.328Z, sink: opensearch, 2000 requests/scenario)

| Sampling | Batch size | Spans generated | Spans exported (retained) | Spans dropped | Retained | Error-trace retention | Export spans/s | Avg batch | Drain after workload | Storage bytes added | Storage reduction vs off |
|---|---|---|---|---|---|---|---|---|---|---|---|
| off | 512 | 9630 | 9630 | 0 | 100% | 100% | 800.4 | 566.5 | 2.2s | 3022063 | - |
| on | 128 | 9630 | 2295 | 7335 | 23.8% | 100% | 103.1 | 120.8 | 12.4s | 1201368 | 60.2% |
| on | 512 | 9630 | 2325 | 7305 | 24.1% | 100% | 108.1 | 232.5 | 12.4s | 1208811 | 60.0% |
