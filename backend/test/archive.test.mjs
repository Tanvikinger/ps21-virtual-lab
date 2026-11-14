import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import S3rver from 's3rver';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { startStack, freePort } from './helpers.mjs';

// A local S3-compatible server (s3rver) exercises the REAL AWS SDK code path (PutObject/HeadObject/List/Get) over HTTP.
// It does NOT prove IAM/real-AWS behaviour - that is verified with scripts/verify-s3.mjs against a real bucket.
process.env.AWS_ACCESS_KEY_ID = 'S3RVER'; process.env.AWS_SECRET_ACCESS_KEY = 'S3RVER'; // dummy, test-only
process.env.AWS_REQUEST_CHECKSUM_CALCULATION = 'WHEN_REQUIRED'; process.env.AWS_RESPONSE_CHECKSUM_VALIDATION = 'WHEN_REQUIRED';

let s3, s3Port, dir, osServer, osUrl; const SPANS = [
  { traceId: 'a'.repeat(32), spanId: '1'.repeat(16), serviceName: 'service-a', name: 'x', startTime: new Date().toISOString(), status: { code: 0 } },
  { traceId: 'a'.repeat(32), spanId: '2'.repeat(16), serviceName: 'service-b', name: 'y', startTime: new Date().toISOString(), status: { code: 2 } },
];
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 's3rver-')); s3Port = await freePort();
  s3 = new S3rver({ port: s3Port, address: '127.0.0.1', silent: true, directory: dir, configureBuckets: [{ name: 'archive-test', configs: [] }] });
  await s3.run();
  // minimal fake OpenSearch: answers _search with SPANS (once), then empty
  osServer = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ hits: { hits: req.url.includes('_search') ? SPANS.map((s, i) => ({ _source: s, sort: [i, i] })) : [] } })); });
  await new Promise((r) => osServer.listen(0, '127.0.0.1', r)); osUrl = `http://127.0.0.1:${osServer.address().port}`;
});
after(async () => { await s3.close(); await new Promise((r) => osServer.close(r)); fs.rmSync(dir, { recursive: true, force: true }); });

test('POST /archive uploads gzip NDJSON to S3, verifies it with HeadObject, content round-trips', async () => {
  const s = await startStack({ S3_BUCKET: 'archive-test', S3_PREFIX: 'telemetry/', AWS_REGION: 'us-east-1', S3_ENDPOINT: `http://127.0.0.1:${s3Port}`, OPENSEARCH_URL: osUrl });
  try {
    const r = await s.post('/archive', { sinceMinutes: 60 }); const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j)); assert.equal(j.status, 'archived'); assert.equal(j.verified, true);
    assert.equal(j.spanCount, 2); assert.equal(j.traceCount, 1); assert.match(j.key, /^telemetry\/\d{4}\/\d{2}\/\d{2}\/spans-.*\.ndjson\.gz$/);
    const client = new S3Client({ region: 'us-east-1', endpoint: `http://127.0.0.1:${s3Port}`, forcePathStyle: true });
    const obj = await client.send(new GetObjectCommand({ Bucket: 'archive-test', Key: j.key }));
    const raw = Buffer.from(await obj.Body.transformToByteArray());
    const text = (raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw).toString('utf8');
    assert.deepEqual(text.trim().split('\n').map((l) => JSON.parse(l).spanId), ['1'.repeat(16), '2'.repeat(16)]);
    const list = await (await fetch(`${s.base}/archive/objects`)).json(); assert.ok(list.objects.some((o) => o.key === j.key));
    const hist = await (await fetch(`${s.base}/archive/history`)).json(); assert.equal(hist.archives[0].key, j.key);
  } finally { await s.stop(); }
});

test('POST /archive without S3_BUCKET returns 503 archive_not_configured (no fake success)', async () => {
  const s = await startStack({ OPENSEARCH_URL: osUrl });
  try { const r = await s.post('/archive', {}); assert.equal(r.status, 503); assert.equal((await r.json()).error, 'archive_not_configured'); } finally { await s.stop(); }
});

test('POST /archive with OpenSearch down returns 502 and uploads nothing', async () => {
  const s = await startStack({ S3_BUCKET: 'archive-test', AWS_REGION: 'us-east-1', S3_ENDPOINT: `http://127.0.0.1:${s3Port}`, OPENSEARCH_URL: 'http://127.0.0.1:9' });
  try { const r = await s.post('/archive', {}); assert.equal(r.status, 502); assert.equal((await r.json()).error, 'archive_failed'); } finally { await s.stop(); }
});

test('POST /archive validates input', async () => {
  const s = await startStack({ S3_BUCKET: 'archive-test', OPENSEARCH_URL: osUrl });
  try { assert.equal((await s.post('/archive', { sinceMinutes: -5 })).status, 400); assert.equal((await s.post('/archive', { traceIds: ['nope'] })).status, 400); } finally { await s.stop(); }
});
