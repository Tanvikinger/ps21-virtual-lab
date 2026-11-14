# Setup (Windows, PowerShell, Docker Desktop, VS Code)

## Prerequisites
Docker Desktop running (WSL2, give it ≥ 4 GB RAM), Node.js 20/22, Git, AWS CLI configured (`aws sts get-caller-identity` works).

## 1. Configure
```powershell
Copy-Item .env.example .env
notepad .env        # set S3_BUCKET and AWS_REGION (same region as the bucket); keep CLOUDWATCH_ENABLED=true
```
Never commit `.env` (it is in `.gitignore`).

## 2. Start everything
```powershell
cd backend; npm install; cd ..     # once: refreshes backend/package-lock.json (adds the CloudWatch SDK)
docker compose -f docker-compose.yml -f docker-compose.aws.yml up -d --build
docker compose ps                   # 5 services; OpenSearch needs ~60 s to become healthy
```
Open **http://localhost:4000**. The header badge must say **System healthy**.

## 3. Check it works
```powershell
curl.exe http://localhost:4000/health
node scripts/verify-pipeline.mjs --sink opensearch:http://localhost:9200 --count 300 --wait 30
```
Then in the UI: *Traffic & Traces → Send requests*, *Dashboard* (graphs move), *AWS Cloud → Archive to S3* and *Publish now*.

## UI development (optional)
```powershell
npm ci
npm run dev          # http://localhost:5173, talks to the backend on :4000
npm run build        # type-check + production build
npm test
```

## Troubleshooting
| Symptom | Fix |
|---|---|
| Header says *Backend offline* | `docker compose ps`; `docker compose logs backend` |
| OpenSearch keeps restarting | Docker Desktop memory < 4 GB, or `wsl -d docker-desktop sysctl -w vm.max_map_count=262144` |
| AWS Cloud page: *Unable to locate / load credentials* | You started without the AWS override. Use the `-f docker-compose.aws.yml` command above, and run `aws sso login` if you use SSO |
| S3: *AccessDenied* | IAM user lacks the policy in docs/AWS_SETUP.md step 3 |
| CloudWatch charts empty | Data takes 1-2 min to appear; press Publish now, then Refresh |
| Port already in use | `docker compose down` first (or stop the old project's containers) |
