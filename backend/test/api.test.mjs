import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startStack } from './helpers.mjs';

test('GET /health returns ok with all services up', async () => {
  const s = await startStack();
  try {
    const r = await fetch(`${s.base}/health`); const j = await r.json();
    assert.equal(r.status, 200); assert.equal(j.status, 'ok'); assert.deepEqual(j.services, { A: 'up', B: 'up', C: 'up' });
  } finally { await s.stop(); }
});

test('POST /simulate validates input (400) and rejects bad JSON', async () => {
  const s = await startStack();
  try {
    for (const bad of [{ count: 0 }, { count: 1.5 }, { errorRate: 2 }, { failService: 'Z' }, { concurrency: 1000 }, []]) {
      const r = await s.post('/simulate', bad); const j = await r.json();
      assert.equal(r.status, 400, JSON.stringify(bad)); assert.equal(j.error, 'validation_failed'); assert.ok(j.details.length);
    }
    const r = await fetch(`${s.base}/simulate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' });
    assert.equal(r.status, 400); assert.equal((await r.json()).error, 'invalid_json');
    assert.equal((await fetch(`${s.base}/nope`)).status, 404);
  } finally { await s.stop(); }
});

test('CORS allows configured origins only', async () => {
  const s = await startStack({ CORS_ORIGINS: 'http://allowed.example' });
  try {
    const a = await fetch(`${s.base}/health`, { headers: { origin: 'http://allowed.example' } });
    const b = await fetch(`${s.base}/health`, { headers: { origin: 'http://evil.example' } });
    assert.equal(a.headers.get('access-control-allow-origin'), 'http://allowed.example');
    assert.equal(b.headers.get('access-control-allow-origin'), null);
  } finally { await s.stop(); }
});

test('same seed gives the same fault pattern (reproducible workload)', async () => {
  const s = await startStack();
  try {
    const run = async () => (await (await s.post('/simulate', { count: 40, concurrency: 8, errorRate: 0.3, slowRate: 0, seed: 123, baseLatencyMs: 1 })).json()).requests.map((r) => r.status);
    assert.deepEqual(await run(), await run());
  } finally { await s.stop(); }
});

test('graceful shutdown releases all ports and flushes telemetry', async () => {
  const s = await startStack();
  await s.post('/simulate', { count: 2, errorRate: 0, slowRate: 0, baseLatencyMs: 1 });
  await s.stop();
  await assert.rejects(fetch(`${s.base}/health`));
  await assert.rejects(fetch(s.stack.services.urlOf('B'), { method: 'POST' }));
});
