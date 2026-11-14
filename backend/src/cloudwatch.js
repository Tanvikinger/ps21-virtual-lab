// Amazon CloudWatch integration. The backend publishes CUSTOM METRICS (namespace e.g. "TraceFlow/Telemetry") about the
// traffic it served and the telemetry pipeline, can read them back from CloudWatch to prove they arrived, and can create
// an error-rate alarm. All AWS calls go through an `adapter` (real: cloudwatchAws.js; tests: a fake).
import { createAwsCloudWatchAdapter } from './cloudwatchAws.js';
import { log } from './log.js';

export class CloudWatchDisabled extends Error {}

// What is read back for the Cloud page (and the statistic that makes sense for each).
export const READBACK = [
  { name: 'Requests', stat: 'Sum' }, { name: 'FailedRequests', stat: 'Sum' }, { name: 'ErrorRatePercent', stat: 'Average' },
  { name: 'AvgLatencyMs', stat: 'Average' }, { name: 'P95LatencyMs', stat: 'Average' }, { name: 'SpansExported', stat: 'Sum' }, { name: 'IndexedSpans', stat: 'Maximum' },
];

const p95 = (arr) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.ceil(0.95 * s.length) - 1]; };

export function createCloudWatch({ config, adapter: injected, getGauges = async () => ({}) }) {
  const c = config.cloudwatch;
  const dimensions = [{ Name: 'Environment', Value: c.environment }];
  const alarmName = `${c.namespace.split('/')[0]}-HighErrorRate`;
  let adapterP = injected ? Promise.resolve(injected) : null;
  const adapter = () => { if (!c.enabled) throw new CloudWatchDisabled('CloudWatch is disabled'); adapterP ??= createAwsCloudWatchAdapter({ region: c.region }); return adapterP; };

  let acc = { ok: 0, failed: 0, durations: [] };
  let lastSdk = { exported: 0 };
  const state = { lastPublishAt: null, lastError: null, publishedBatches: 0, lastMetrics: null };
  let timer; let publishing = false;

  async function publish({ force = false } = {}) {
    const a = await adapter();
    if (publishing) return { skipped: true, reason: 'a publish is already running' };
    publishing = true;
    const w = acc; acc = { ok: 0, failed: 0, durations: [] };
    try {
      const n = w.ok + w.failed;
      if (!n && !force) return { skipped: true, reason: 'no requests since the last publish' };
      const g = await getGauges().catch(() => ({}));
      const now = new Date();
      const m = (MetricName, Value, Unit) => ({ MetricName, Value, Unit, Timestamp: now, Dimensions: dimensions });
      const data = [
        m('Requests', n, 'Count'), m('FailedRequests', w.failed, 'Count'), m('ErrorRatePercent', n ? (100 * w.failed) / n : 0, 'Percent'),
        ...(n ? [m('AvgLatencyMs', w.durations.reduce((x, y) => x + y, 0) / n, 'Milliseconds'), m('P95LatencyMs', p95(w.durations), 'Milliseconds')] : []),
      ];
      if (typeof g.sdkExportedSpans === 'number') { data.push(m('SpansExported', Math.max(0, g.sdkExportedSpans - lastSdk.exported), 'Count')); lastSdk.exported = g.sdkExportedSpans; }
      if (typeof g.indexedSpans === 'number') data.push(m('IndexedSpans', g.indexedSpans, 'Count'));
      try { await a.putMetrics(c.namespace, data); }
      catch (e) { acc.ok += w.ok; acc.failed += w.failed; acc.durations.push(...w.durations); throw e; } // keep the data for the next try
      state.lastPublishAt = now.toISOString(); state.lastError = null; state.publishedBatches += 1;
      state.lastMetrics = Object.fromEntries(data.map((d) => [d.MetricName, d.Value]));
      return { published: data.length, namespace: c.namespace, at: state.lastPublishAt, metrics: state.lastMetrics };
    } catch (e) { state.lastError = e.message; throw e; }
    finally { publishing = false; }
  }

  return {
    enabled: () => c.enabled,
    record({ ok, durationMs }) { if (!c.enabled) return; if (ok) acc.ok += 1; else acc.failed += 1; acc.durations.push(durationMs); },
    status: () => ({ enabled: c.enabled, namespace: c.namespace, region: c.region ?? null, intervalSec: c.intervalSec, environment: c.environment, alarmName, ...state }),
    publish,
    async metrics({ minutes = 30 } = {}) {
      const a = await adapter();
      const periodSec = minutes <= 60 ? 60 : 300;
      const endMs = Date.now();
      const series = await a.getMetrics({ namespace: c.namespace, dimensions, metrics: READBACK, startMs: endMs - minutes * 60000, endMs, periodSec });
      return { namespace: c.namespace, periodSec, minutes, series };
    },
    async createAlarm() {
      const a = await adapter();
      await a.putAlarm({
        AlarmName: alarmName, AlarmDescription: `Error rate of requests served by TraceFlow above ${c.errorAlarmPct}%`,
        Namespace: c.namespace, MetricName: 'ErrorRatePercent', Dimensions: dimensions, Statistic: 'Average', Period: 60, EvaluationPeriods: 1,
        Threshold: c.errorAlarmPct, ComparisonOperator: 'GreaterThanThreshold', TreatMissingData: 'notBreaching',
      });
      return { created: alarmName, thresholdPct: c.errorAlarmPct };
    },
    async alarms() { const a = await adapter(); return { alarms: await a.listAlarms(alarmName) }; },
    start() {
      if (!c.enabled || timer) return;
      timer = setInterval(() => { publish().catch((e) => log('warn', 'cloudwatch publish failed', { message: e.message })); }, c.intervalSec * 1000);
      timer.unref?.();
    },
    async stop() { if (timer) clearInterval(timer); timer = undefined; if (c.enabled && state.publishedBatches >= 0) await publish().catch(() => {}); },
  };
}
