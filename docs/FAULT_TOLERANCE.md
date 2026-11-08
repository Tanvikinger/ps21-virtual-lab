# Fault tolerance demonstrations (measured)

Run on your stack:
```powershell
node scripts/fault-demo.mjs service-crash     --sink opensearch:http://localhost:9200
node scripts/fault-demo.mjs collector-restart --sink opensearch:http://localhost:9200 --down-seconds 6
node scripts/fault-demo.mjs collector-restart --sink opensearch:http://localhost:9200 --down-seconds 20
```
Plus manual controls: Real Telemetry page (crash/recover buttons), `POST /faults/{A|B|C}/crash|recover`, `POST /faults {service, errorRate, extraLatencyMs}`, `DELETE /faults`.

## Results from the delivery environment (real Collector, file exporter, 40 requests per batch)

### 1. Service B crash and recovery
B's HTTP listener is really closed, so A gets a real `ECONNREFUSED`.
| Phase | Result |
|---|---|
| While B down | 0/40 ok, error `service-b unreachable (ECONNREFUSED)` |
| Traces during the crash retained | **40/40** (error traces are always kept, with A's error span + exception) |
| After recovery | 40/40 requests ok; ordinary traces back to normal sampling (6/40 retained, ~10% expected) |

### 2. Collector restart (collector killed, then started)
All test traces were errors, so sampling would keep every one if the Collector were healthy.
| Batch | 6 s outage | 20 s outage |
|---|---|---|
| 1: sent just before the Collector stopped (inside decision window) | **0/40 retained** | **0/40 retained** |
| 2: sent while the Collector was down | 40/40 retained | **0/40 retained** |
| 3: sent after restart | 40/40 retained | 40/40 retained |
| SDK-side failed-to-export spans (counted, visible in /pipeline/metrics) | 40 | 400 |

## What this proves, and the real limits
- **Recovery works**: after the Collector or a service returns, new traffic is processed normally.
- **Error retention under service failure works**: failed requests are the ones kept.
- **Traces sitting in the tail sampler's memory are lost when the Collector dies** (batch 1). The decision buffer is in RAM.
- **Short outages are absorbed by the SDK's OTLP retry** (6 s case); **outages longer than the SDK export timeout (10 s default) lose data** (20 s case). The loss is counted (`sdk.failedSpans`), not hidden.
- Mitigations not implemented (out of scope for the prototype): Collector persistent queue (`file_storage`), multiple Collectors behind a load-balancing exporter, Kafka/queue between SDK and Collector.
- Backend graceful shutdown (SIGTERM): stops accepting requests, waits for in-flight ones, flushes spans (bounded to 5 s), exit code 0 (tested with a real process).
