# Deploy TraceFlow on one EC2 server (single URL)

The backend container serves the web UI **and** the API, so deployment = one server running `docker compose`. No keys on the server: an **IAM role** gives it S3 and CloudWatch access.

## 1. Create the IAM role (once)
IAM → Roles → Create role → *AWS service* → **EC2** → attach a custom policy containing the S3 policy (AWS_SETUP.md step 3) **and** the CloudWatch policy (step 3b). Name it `traceflow-ec2-role`.

## 2. Launch the instance
- AMI: Ubuntu 24.04 LTS · Type: **t3.medium** (4 GB RAM; OpenSearch + Collector + Data Prepper need it, t3.micro/small will fail) · Disk: 20 GB
- IAM instance profile: `traceflow-ec2-role`
- Security group inbound: SSH (22) and **TCP 4000 from *My IP* only**. The app has no login, so do not open 4000 to the whole internet.

## 3. Install Docker and run
Connect (EC2 Instance Connect or SSH), then:
```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
sudo usermod -aG docker $USER && newgrp docker
git clone <your-github-repo-url> traceflow && cd traceflow
cp .env.example .env
nano .env
```
Set in `.env`:
```
BACKEND_BIND=0.0.0.0
S3_BUCKET=<your bucket>
AWS_REGION=<region>
CLOUDWATCH_ENABLED=true
DEPLOY_ENV=production
```
(Leave `AWS_PROFILE` empty/unset on EC2.) Then:
```bash
sudo sysctl -w vm.max_map_count=262144
docker compose up -d --build
docker compose ps
```
Open `http://<EC2-public-IP>:4000`.

## 4. Update after a code change
```bash
cd traceflow && git pull && docker compose up -d --build
```

## 5. Stop paying when you are done
Stop (not terminate) the instance after the evaluation; a stopped instance costs only its disk. Terminate it and delete the bucket/alarms when the project is over (docs/CLEANUP.md).
