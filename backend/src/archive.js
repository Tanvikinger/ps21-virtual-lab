// Real Amazon S3 archival: telemetry (spans read back from OpenSearch) -> NDJSON -> gzip -> PutObject -> HeadObject verify.
import { createHash, randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { S3Client, PutObjectCommand, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

export class ArchiveNotConfigured extends Error {}

export function createArchiver({ config, opensearch }) {
  const c = config.s3;
  let client;
  const s3 = () => {
    if (!c.bucket) throw new ArchiveNotConfigured('S3_BUCKET is not set');
    // Credentials are NOT passed here: the SDK default chain (env / shared profile / SSO / IAM role) is used.
    client ??= new S3Client({ region: c.region, ...(c.endpoint ? { endpoint: c.endpoint, forcePathStyle: true } : {}) });
    return client;
  };
  const history = [];

  return {
    configured: () => Boolean(c.bucket),
    history: () => history.slice().reverse(),
    async archive({ sinceMs, untilMs, traceIds } = {}) {
      const client = s3();
      const spans = await opensearch.fetchSpans({ sinceMs, untilMs, traceIds, limit: c.maxSpansPerArchive });
      if (spans.length === 0) return { status: 'empty', message: 'No spans found in OpenSearch for this selection; nothing was uploaded.' };
      const ndjson = spans.map((s) => JSON.stringify(s)).join('\n') + '\n';
      const sha256 = createHash('sha256').update(ndjson).digest('hex');
      const body = gzipSync(Buffer.from(ndjson));
      const now = new Date();
      const day = now.toISOString().slice(0, 10).replaceAll('-', '/');
      const key = `${c.prefix}${day}/spans-${now.toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}.ndjson.gz`;
      const traceCount = new Set(spans.map((s) => s.traceId)).size;
      const put = await client.send(new PutObjectCommand({
        Bucket: c.bucket, Key: key, Body: body, ContentType: 'application/x-ndjson', ContentEncoding: 'gzip',
        ...(c.storageClass ? { StorageClass: c.storageClass } : {}),
        Metadata: { 'span-count': String(spans.length), 'trace-count': String(traceCount), 'ndjson-sha256': sha256 },
      }));
      // Verify: the object must exist with the same size and checksum metadata we sent.
      const head = await client.send(new HeadObjectCommand({ Bucket: c.bucket, Key: key }));
      const verified = head.ContentLength === body.length && head.Metadata?.['ndjson-sha256'] === sha256;
      const rec = {
        status: verified ? 'archived' : 'verification_failed', verified, bucket: c.bucket, key, bytesUploaded: body.length, bytesUncompressed: Buffer.byteLength(ndjson),
        spanCount: spans.length, traceCount, etag: put.ETag, storageClass: head.StorageClass ?? c.storageClass ?? 'STANDARD', archivedAt: now.toISOString(),
      };
      history.push(rec); if (history.length > 100) history.shift();
      return rec;
    },
    async list(limit = 50) {
      const r = await s3().send(new ListObjectsV2Command({ Bucket: c.bucket, Prefix: c.prefix, MaxKeys: limit }));
      return (r.Contents ?? []).map((o) => ({ key: o.Key, size: o.Size, lastModified: o.LastModified, storageClass: o.StorageClass }));
    },
  };
}
