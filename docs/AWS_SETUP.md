# AWS guide: S3 archive and CloudWatch monitoring

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
$B = "traceflow-archive-<yourname>-<random>"
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

## 4. Verify the bucket from the command line
```powershell
cd backend
$env:S3_BUCKET = $B; $env:AWS_REGION = $R
npm run verify:s3
```
Expected: all `PASS` and "S3 verification PASSED". Any `FAIL` line names the IAM action that is missing.

## 3b. IAM policy for CloudWatch (add to the same user/role)
```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "PublishMetrics", "Effect": "Allow", "Action": "cloudwatch:PutMetricData", "Resource": "*",
      "Condition": { "StringEquals": { "cloudwatch:namespace": "TraceFlow/Telemetry" } } },
    { "Sid": "ReadAndAlarm", "Effect": "Allow", "Action": ["cloudwatch:GetMetricData", "cloudwatch:PutMetricAlarm", "cloudwatch:DescribeAlarms"], "Resource": "*" }
  ]
}
```

## 5. Connect the app to S3 and CloudWatch
Edit `.env` (no keys!):
```
S3_BUCKET=<your bucket>
AWS_REGION=<bucket region>
AWS_PROFILE=default
CLOUDWATCH_ENABLED=true
```
Start with your AWS profile mounted read-only (SSO users: `aws sso login` first):
```powershell
cd backend; npm install; cd ..
docker compose -f docker-compose.yml -f docker-compose.aws.yml up -d --build
```
Check in the UI, page **AWS Cloud**: both badges say *connected*.
- **S3:** send traffic, wait ~30 s (indexing), press **Archive to S3** → result shows *verified*; the object appears in the list. Also: `aws s3 ls s3://$B/telemetry/ --recursive`.
  `verified` means HeadObject returned the same size and SHA-256 metadata that was uploaded. If OpenSearch has no spans you get `empty` and nothing is uploaded.
- **CloudWatch:** metrics are published automatically every 60 s while traffic flows (or press **Publish now**). Charts on the page are read back *from CloudWatch*, so seeing them proves the data arrived (allow 1-2 min). Create the error-rate alarm with the **Create alarm** button.
  In the AWS console: CloudWatch → Metrics → All metrics → custom namespace **TraceFlow/Telemetry**.

Metrics published (dimension `Environment`): `Requests`, `FailedRequests`, `ErrorRatePercent`, `AvgLatencyMs`, `P95LatencyMs`, `SpansExported`, `IndexedSpans`.

## 6. "Cold" storage class (optional)
Keep STANDARD for lab data (IA/Glacier bill a 128 KB minimum per object). To demonstrate tiering set `S3_STORAGE_CLASS=STANDARD_IA` or add a lifecycle rule:
```powershell
@'
{"Rules":[{"ID":"traceflow-cold","Status":"Enabled","Filter":{"Prefix":"telemetry/"},
 "Transitions":[{"Days":30,"StorageClass":"STANDARD_IA"}],"Expiration":{"Days":90}}]}
'@ | Set-Content lifecycle.json
aws s3api put-bucket-lifecycle-configuration --bucket $B --lifecycle-configuration file://lifecycle.json
```

## 7. Cost
S3 at lab scale: cents/month. CloudWatch: the first 10 custom metrics and 10 alarms are in the free tier; this app publishes 7 metrics and 1 alarm. GetMetricData calls are billed per metric requested - negligible for a demo. Always check the AWS pricing page for your region.
Do **not** create a managed OpenSearch domain (costly).

> **Status:** the S3 and CloudWatch code is tested against a local S3 server and a fake CloudWatch (see `backend/test`). Step 5 is how you prove it against your real AWS account.
