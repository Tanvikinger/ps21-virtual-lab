# TraceFlow - Distributed Tracing & Telemetry Collector

A cloud-native observability platform. Requests flow through three real HTTP services (A → B → C) instrumented with
**OpenTelemetry**; spans go to an **OpenTelemetry Collector** (tail sampling + batching), through **Data Prepper** into
**OpenSearch**, are archived to **Amazon S3**, and operational metrics are published to **Amazon CloudWatch**. Everything runs in **Docker**.

## The application (5 pages)
| Page | What it shows |
|---|---|
| **Dashboard** | KPIs, pipeline stages with live counters, and graphs: throughput, latency (avg/p95), error rate, spans through the pipeline, sampling decisions, service health |
| **Pipeline Simulator** | Browser simulation of the whole pipeline: configure traffic, services, SDK, Collector, sampling, batching, OpenSearch and S3, then watch requests and traces flow (deterministic, seeded) |
| **Traffic & Traces** | Generate real traffic; trace list with storage status; span waterfall per trace |
| **Fault Injection** | Crash/slow/err Service A, B or C and watch the effect on error rate and latency |
| **AWS Cloud** | S3 archive (upload + verify + list objects) and CloudWatch (publish metrics, read them back as charts, error-rate alarm) |

## Architecture
```
Browser UI ─► Backend API (:4000) ─► Service A ─► Service B ─► Service C      (real HTTP, W3C trace context)
                    │                    └── spans (OTLP) ──► OpenTelemetry Collector (tail sampling, batch)
                    │                                              └─► Data Prepper ─► OpenSearch ─► Dashboards
                    ├─► Amazon S3          (gzip NDJSON archive of spans, checksum-verified)
                    └─► Amazon CloudWatch  (custom metrics + alarm)
```
Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Run it (Windows, PowerShell)
```powershell
Copy-Item .env.example .env          # then edit S3_BUCKET / AWS_REGION (see docs/AWS_SETUP.md)
docker compose -f docker-compose.yml -f docker-compose.aws.yml up -d --build
```
Open **http://localhost:4000** (the backend serves the web UI). For UI development: `npm ci; npm run dev` → http://localhost:5173.

## Guides
[Setup](docs/SETUP.md) · [AWS: S3 + CloudWatch](docs/AWS_SETUP.md) · [Deploy on EC2](docs/DEPLOY_EC2.md) · [Architecture](docs/ARCHITECTURE.md) · [Benchmarks](docs/BENCHMARKS.md) · [Fault tolerance](docs/FAULT_TOLERANCE.md) · [Demo script + viva Q&A](docs/DEMO_AND_VIVA.md) · [Limitations](docs/LIMITATIONS.md) · [Cleanup](docs/CLEANUP.md) · [Verification status](docs/STATUS.md)

## Tests
```powershell
npm test                       # frontend client tests
cd backend; npm install; npm test   # backend: 21 tests (API, OpenTelemetry, S3, CloudWatch, history)
```
