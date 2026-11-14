import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { startStack } from './helpers.mjs';

test('STATIC_DIR: the backend also serves the built web UI, API routes still win', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-')); fs.writeFileSync(path.join(dir, 'index.html'), '<title>UI</title>');
  const s = await startStack({ STATIC_DIR: dir });
  try {
    assert.match(await (await fetch(`${s.base}/`)).text(), /<title>UI<\/title>/);
    assert.equal((await (await fetch(`${s.base}/health`)).json()).status, 'ok');
    assert.equal((await fetch(`${s.base}/does-not-exist`)).status, 404);
  } finally { await s.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
