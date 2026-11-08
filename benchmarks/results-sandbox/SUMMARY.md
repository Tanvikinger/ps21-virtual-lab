# Benchmark results (measured 2026-11-07T12:03:51.963Z, sink: file, 1500 requests/scenario)

| Sampling | Batch size | Spans generated | Spans exported (retained) | Spans dropped | Retained | Error-trace retention | Export spans/s | Avg batch | Drain after workload | Storage bytes added | Storage reduction vs off |
|---|---|---|---|---|---|---|---|---|---|---|---|
| off | 512 | 7226 | 7226 | 0 | 100% | 100% | 602.8 | 516.1 | 2.1s | 4257791 | - |
| on | 16 | 7226 | 1766 | 5460 | 24.4% | 100% | 87.4 | 17.8 | 12.1s | 1647121 | 61.3% |
| on | 128 | 7226 | 1791 | 5435 | 24.8% | 100% | 87.3 | 119.4 | 12.1s | 1662786 | 60.9% |
| on | 512 | 7226 | 1846 | 5380 | 25.5% | 100% | 87.4 | 184.6 | 12.1s | 1702346 | 60.0% |
| on | 2048 | 7226 | 1841 | 5385 | 25.5% | 100% | 89.2 | 204.6 | 12.1s | 1698910 | 60.1% |
