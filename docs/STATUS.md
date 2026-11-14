# Status checklist

| Item | State | How to check |
|---|---|---|
| Backend: API, OpenTelemetry spans, faults, S3 archive (vs local S3 server), CloudWatch publish/read-back/alarm (vs fake CloudWatch), dashboard history, UI serving | Tested | `cd backend; npm install; npm test` → 21 pass |
| Frontend type-check | Tested | `npx tsc --noEmit` |
| Frontend build, frontend tests, how the 4 pages look in a browser | **Run on your machine** | `npm ci; npm run build; npm test`, then open http://localhost:4000 |
| Docker Compose stack (OpenSearch, Data Prepper, Collector, backend + UI) | **Run on your machine** | `docker compose up -d --build` |
| Real S3 upload / real CloudWatch metrics / IAM permissions | **Run on your AWS account** | docs/AWS_SETUP.md step 5; the *AWS Cloud* page shows any AWS error verbatim |
| Tail sampling, benchmarks, fault tolerance results (earlier work) | Measured earlier | `benchmarks/`, docs/BENCHMARKS.md, docs/FAULT_TOLERANCE.md |
