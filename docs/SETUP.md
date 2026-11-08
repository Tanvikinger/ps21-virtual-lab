# Setup and execution guide (Windows, PowerShell, VS Code, Docker Desktop)

## 0. One-time prerequisites
1. **Docker Desktop** installed and running (WSL2 backend). Give it >= 4 GB RAM (Settings -> Resources).
2. **Node.js 20 or 22** (`node -v`).
3. **Git** and **VS Code**.

## 1. Get the code
Unzip the delivered files into your repo folder (`ps21-virtual-lab`), keeping your `.git`. Then:
```powershell
cd path\to\ps21-virtual-lab
git status          # review the new files before you commit anything
```
> Your repo currently stores the source only inside `ps21-virtual-lab.zip`. After you extract, `src/`, `tests/`, `vite.config.ts`, `tsconfig.json`, `tailwind.config.js` should be committed as normal files (your decision; nothing was committed for you).

## 2. Start the real stack
```powershell
Copy-Item .env.example .env        # optional; defaults work without editing
docker compose up -d --build
docker compose ps
```
Expected: 5 services (`opensearch`, `opensearch-dashboards`, `data-prepper`, `otel-collector`, `backend`). OpenSearch takes ~30-60 s to become healthy; the others wait for it.

Check:
```powershell
curl.exe http://localhost:4000/health        # {"status":"ok",...,"services":{"A":"up","B":"up","C":"up"}}
curl.exe http://localhost:13133              # Collector: "Server available"
curl.exe http://localhost:9200/_cluster/health
```

## 3. Start the frontend
```powershell
npm ci
npm run dev
```
Open http://localhost:5173 -> **Real Telemetry (backend)** -> *Send requests*. The Connection panel should say **Connected**.

## 4. Verify the pipeline end to end
```powershell
node scripts/verify-pipeline.mjs --sink opensearch:http://localhost:9200 --count 300 --wait 30
```
Expected: all lines `PASS` (all error traces retained, slow traces retained, ordinary traces ~10%, no partial traces). Then open http://localhost:5601 -> Observability -> **Trace analytics** -> Traces, or query:
```powershell
curl.exe "http://localhost:9200/otel-v1-apm-span-*/_count"
```

## 5. Tests
```powershell
npm test                          # frontend: 19 tests
npm run build                     # frontend build
cd backend; npm ci; npm test      # backend: 15 tests
```

## 6. S3 and the rest
See `docs/AWS_SETUP.md`, `docs/BENCHMARKS.md`, `docs/FAULT_TOLERANCE.md`.

## Troubleshooting
| Symptom | Fix |
|---|---|
| OpenSearch keeps restarting | Docker Desktop memory < 4 GB, or in WSL: `wsl -d docker-desktop sysctl -w vm.max_map_count=262144` |
| Real page says "Cannot reach the backend" | `docker compose logs backend`; check `curl.exe localhost:4000/health`; on the Netlify site the backend must run on YOUR PC and CORS_ORIGINS must include the site origin |
| Trace shows "Not indexed (inferred)" | Normal for ~90% of ordinary fast successful traces (sampled out). Error and slow traces should appear after ~15-20 s |
| Collector exits at start | `docker compose logs otel-collector` (config error text is explicit) |
| Data Prepper errors | `docker compose logs data-prepper`; it retries until OpenSearch is ready |
| Port already in use | stop the other program or change the left side of the port mapping |
