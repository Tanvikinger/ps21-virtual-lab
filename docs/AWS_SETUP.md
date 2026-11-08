# AWS guide: S3 archival, CloudWatch, optional EC2

Nothing here creates a paid resource by itself. Run each command yourself after reading its cost note.
S3 for lab-scale data costs cents per month (check the AWS pricing page for your region). **Do not create a managed OpenSearch domain** (costly).

## 1. Check your existing setup (PowerShell)
```powershell
aws sts get-caller-identity          # which account/user you are
aws configure get region             # use the SAME region as your other project, or ap-south-1
aws s3 ls                            # existing buckets (do not touch them)
```
If `get-caller-identity` fails: `aws configure sso` / `aws sso login`, or `aws configure` (keys are stored in ~/.aws, never in this repo).

## 2. Create a private bucket (bucket names are global: add a random suffix)
```powershell
$B = "ps21-telemetry-archive-<yourname>-<random>"
$R = "ap-south-1"
aws s3api create-bucket --bucket $B --region $R --create-bucket-configuration LocationConstraint=$R
aws s3api put-public-access-block --bucket $B --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```
(For `us-east-1` omit `--create-bucket-configuration`.) S3 encrypts new objects with SSE-S3 by default.

## 3. Least-privilege IAM policy
Attach to the IAM user/role that the backend uses (replace BUCKET):
```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "BucketLevel", "Effect": "Allow", "Action": ["s3:ListBucket"], "Resource": "arn:aws:s3:::BUCKET" },
    { "Sid": "ArchiveObjects", "Effect": "Allow", "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"], "Resource": "arn:aws:s3:::BUCKET/telemetry/*" }
  ]
}
```
(`DeleteObject` is only needed by `verify-s3` to remove its own test object.)

## 4. Verify against the REAL bucket
```powershell
cd backend
$env:S3_BUCKET = $B; $env:AWS_REGION = $R
npm run verify:s3
```
Expected: all `PASS` and "S3 verification PASSED". Any `FAIL` line names the IAM action that is missing.

## 5. Run archival from the stack
Add to `.env` (no keys!): `S3_BUCKET=...`, `AWS_REGION=...`, `AWS_PROFILE=default`, then use the override that mounts your AWS profile read-only:
```powershell
docker compose -f docker-compose.yml -f docker-compose.aws.yml up -d --build backend
```
If you use SSO: `aws sso login` first. Then **Real Telemetry -> Archive last 60 min to S3**, or:
```powershell
curl.exe -X POST http://localhost:4000/archive -H "content-type: application/json" -d "{\"sinceMinutes\":60}"
aws s3 ls s3://$B/telemetry/ --recursive
```
Response contains `status: "archived"`, `verified: true`, bucket, key, bytes, span/trace counts. `verified` means HeadObject returned the same size and SHA-256 metadata that was uploaded. If OpenSearch has no spans you get `status: "empty"` and nothing is uploaded.

> **Status:** the S3 code path is tested against a local S3-compatible server (`s3rver`) in `backend/test/archive.test.mjs`. It has **not** been run against real AWS from the delivery environment (no AWS credentials available there). Step 4 is how you prove it on your account.

## 6. "Cold" storage class (optional)
Archive objects are small. IA/Glacier classes bill a 128 KB minimum per object and have minimum retention, so for lab data keep STANDARD unless you want to demonstrate tiering. To demonstrate: set `S3_STORAGE_CLASS=STANDARD_IA`, or add a lifecycle rule:
```powershell
@'
{"Rules":[{"ID":"ps21-cold","Status":"Enabled","Filter":{"Prefix":"telemetry/"},
 "Transitions":[{"Days":30,"StorageClass":"STANDARD_IA"}],"Expiration":{"Days":90}}]}
'@ | Set-Content lifecycle.json
aws s3api put-bucket-lifecycle-configuration --bucket $B --lifecycle-configuration file://lifecycle.json
```

## 7. CloudWatch (optional monitoring)
S3 publishes daily storage metrics to CloudWatch for free:
```powershell
aws cloudwatch get-metric-statistics --namespace AWS/S3 --metric-name BucketSizeBytes `
  --dimensions Name=BucketName,Value=$B Name=StorageType,Value=StandardStorage `
  --start-time (Get-Date).AddDays(-3).ToString("s") --end-time (Get-Date).ToString("s") --period 86400 --statistics Average --region $R
```
Cost guard alarm (alarm if the archive exceeds 1 GB; needs an SNS topic ARN for notifications, optional):
```powershell
aws cloudwatch put-metric-alarm --alarm-name ps21-archive-size --namespace AWS/S3 --metric-name BucketSizeBytes `
  --dimensions Name=BucketName,Value=$B Name=StorageType,Value=StandardStorage --statistic Average --period 86400 `
  --evaluation-periods 1 --threshold 1073741824 --comparison-operator GreaterThanThreshold --region $R
```
If you deploy on EC2, CPU/network metrics appear automatically in CloudWatch (namespace `AWS/EC2`). The app itself does not push custom metrics to CloudWatch.

## 8. Optional: run the whole stack on EC2 (NOT required)
- OpenSearch with a 512 MB heap needs a 4 GB machine (e.g. `t3.medium`; about a few cents per hour: confirm on the pricing page).
- Console: launch Ubuntu 24.04, 30 GB gp3, security group allowing **only your IP** on SSH (22). Do **not** open 9200/5601/4000 publicly (OpenSearch security is disabled in this lab). Use `ssh -L 5601:localhost:5601 -L 4000:localhost:4000 ...` to reach them.
- Attach an IAM role with the policy in step 3 (no keys on the box), install Docker, clone the repo, `docker compose up -d --build`.
- **Stop or terminate the instance when done** (see `docs/CLEANUP.md`); a running instance and its EBS volume bill until deleted.
