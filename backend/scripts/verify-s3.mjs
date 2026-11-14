// Verifies REAL AWS S3 access with your current credentials (SDK default chain). Run from backend/:
//   $env:S3_BUCKET="your-bucket"; $env:AWS_REGION="ap-south-1"; npm run verify:s3
// It writes ONE tiny test object, reads it back, then deletes only that object. No other data is touched.
import { S3Client, HeadBucketCommand, PutObjectCommand, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

const bucket = process.env.S3_BUCKET; const prefix = (process.env.S3_PREFIX ?? 'telemetry/').replace(/^\/+/, '');
if (!bucket) { console.error('Set S3_BUCKET first.'); process.exit(2); }
const s3 = new S3Client({ region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION, ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true } : {}) });
const key = `${prefix}_verify/traceflow-verify-${Date.now()}.txt`; const body = `traceflow s3 verification ${new Date().toISOString()}`;
let failed = false;
const step = async (name, fn, hint) => {
  try { const r = await fn(); console.log(`PASS  ${name}${r ? '  ' + r : ''}`); return true; }
  catch (e) { failed = true; console.log(`FAIL  ${name}  -> ${e.name}: ${e.message}${hint ? `\n      hint: ${hint}` : ''}`); return false; }
};
await step('credentials + bucket reachable (HeadBucket)', async () => { await s3.send(new HeadBucketCommand({ Bucket: bucket })); }, 'check AWS_REGION, bucket name, and that your credentials are valid (aws sts get-caller-identity)');
await step(`list prefix ${prefix} (s3:ListBucket)`, async () => { const r = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: 1 })); return `${r.KeyCount} key(s)`; }, 'IAM policy needs s3:ListBucket on the bucket');
if (await step('upload test object (s3:PutObject)', async () => { await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: 'text/plain' })); return key; }, 'IAM policy needs s3:PutObject on arn:aws:s3:::BUCKET/PREFIX*')) {
  await step('verify object exists (HeadObject)', async () => { const h = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key })); if (h.ContentLength !== Buffer.byteLength(body)) throw new Error('size mismatch'); return `${h.ContentLength} bytes, class ${h.StorageClass ?? 'STANDARD'}`; });
  await step('read back (s3:GetObject) and compare content', async () => { const g = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key })); if ((await g.Body.transformToString()) !== body) throw new Error('content mismatch'); }, 'IAM policy needs s3:GetObject');
  await step('cleanup: delete ONLY the test object (s3:DeleteObject)', async () => { await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })); }, `delete manually: aws s3 rm s3://${bucket}/${key}`);
}
console.log(failed ? '\nS3 verification FAILED - archival will not work until the FAIL lines are fixed.' : '\nS3 verification PASSED against the real bucket.');
process.exit(failed ? 1 : 0);
