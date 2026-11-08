import http from 'node:http';
import net from 'node:net';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';

export const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });

/** Fake OTLP/HTTP receiver: collects the JSON spans the SDK really sends over the wire. */
export async function startFakeOtlp() {
  const spans = []; const resources = [];
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        for (const rs of JSON.parse(body).resourceSpans ?? []) {
          const svc = rs.resource.attributes.find((a) => a.key === 'service.name')?.value.stringValue;
          resources.push(svc);
          for (const ss of rs.scopeSpans) for (const sp of ss.spans) spans.push({ ...sp, service: svc });
        }
      } catch { /* ignore */ }
      res.setHeader('content-type', 'application/json'); res.end('{}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { spans, endpoint: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

export async function startStack(env = {}, overrides = {}) {
  const otlp = env.OTEL_EXPORTER_OTLP_ENDPOINT ? null : await startFakeOtlp();
  const config = loadConfig({
    API_PORT: '0', HOST: '127.0.0.1', SERVICE_A_PORT: String(await freePort()), SERVICE_B_PORT: String(await freePort()), SERVICE_C_PORT: String(await freePort()),
    OTEL_EXPORTER_OTLP_ENDPOINT: otlp?.endpoint, OTEL_BSP_SCHEDULE_DELAY: '100', ...env,
  });
  const stack = createApp(config, overrides);
  const port = await stack.start();
  const base = `http://127.0.0.1:${port}`;
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const waitForSpans = async (n, ms = 5000) => { const t = Date.now(); while (otlp.spans.length < n && Date.now() - t < ms) { await stack.telemetry.forceFlush(); await new Promise((r) => setTimeout(r, 50)); } };
  return { stack, base, post, otlp, config, waitForSpans, async stop() { await stack.stop(); await otlp?.close(); } };
}
