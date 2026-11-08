import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { log } from './log.js';

const config = loadConfig();
const stack = createApp(config);
const port = await stack.start();
log('info', 'backend started', { apiPort: port, services: config.servicePorts, otlp: config.otlpEndpoint, s3Configured: Boolean(config.s3.bucket) });

let stopping = false;
const shutdown = async (sig) => {
  if (stopping) return; stopping = true;
  log('info', 'graceful shutdown', { signal: sig });
  try { await stack.stop(); log('info', 'stopped cleanly'); process.exit(0); }
  catch (e) { log('error', 'shutdown error', { message: e.message }); process.exit(1); }
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
