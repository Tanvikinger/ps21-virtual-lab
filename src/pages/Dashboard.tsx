import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, ExternalLink } from 'lucide-react';
import { BarsChart, ChartCard, COLORS, TimeChart } from '../components/Charts';
import { Dot, Empty, PageHeader, Panel, Stat, fmtMs } from '../components/ui';
import { api, type HistoryPoint, type PipelineMetrics } from '../realApi';
import type { Backend } from '../useBackend';

const RANGES = [{ m: 5, label: '5 min' }, { m: 15, label: '15 min' }, { m: 60, label: '1 hour' }];

function Stage({ name, sub, value, tone }: { name: string; sub: string; value: string; tone: 'green' | 'red' | 'amber' | 'slate' }) {
  return (
    <div className="min-w-[120px] flex-1 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800"><Dot tone={tone} />{name}</div>
      <div className="mt-1 text-lg font-semibold text-slate-900">{value}</div>
      <div className="text-[11px] text-slate-500">{sub}</div>
    </div>
  );
}

export function DashboardPage({ b }: { b: Backend }) {
  const [minutes, setMinutes] = useState(15);
  const [pts, setPts] = useState<HistoryPoint[]>([]);
  const [m, setM] = useState<PipelineMetrics | null>(null);
  const ok = b.health.ok;

  const load = useCallback(async () => {
    try { const [h, p] = await Promise.all([api.history(minutes), api.metrics()]); setPts(h.points); setM(p); } catch { /* shown via connection badge */ }
  }, [minutes]);
  useEffect(() => { if (!ok) return; load(); const id = setInterval(load, 5000); return () => clearInterval(id); }, [ok, load]);

  const c = m?.collector; const req = m?.requests;
  const total = req?.requests ?? 0; const failed = req?.failed ?? 0;
  const traffic = pts.filter((p) => p.requests > 0);
  const avg = traffic.length ? traffic.reduce((a, p) => a + p.avgLatencyMs * p.requests, 0) / traffic.reduce((a, p) => a + p.requests, 0) : 0;
  const p95 = traffic.length ? Math.max(...traffic.map((p) => p.p95LatencyMs)) : 0;
  const policies = Object.entries(c?.tailSampling.byPolicy ?? {});
  const polName = (k: string) => (k.includes('error') ? 'Errors' : k.includes('slow') ? 'Slow' : k.includes('ordinary') ? 'Ordinary (10%)' : k);
  const polColor = (k: string) => (k.includes('error') ? COLORS.red : k.includes('slow') ? COLORS.amber : COLORS.blue);
  const svc = b.health.data?.services;

  return (
    <div className="space-y-4">
      <PageHeader title="Dashboard" sub="Live health, traffic and telemetry-pipeline metrics, refreshed every 5 seconds."
        right={<div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-300 bg-white p-0.5 text-xs">{RANGES.map((r) => <button key={r.m} onClick={() => setMinutes(r.m)} className={`rounded-md px-2.5 py-1 ${minutes === r.m ? 'bg-sky-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{r.label}</button>)}</div>
          {b.cfg && <a className="btn btn-ghost btn-sm" href={b.cfg.dashboardsUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} />OpenSearch Dashboards</a>}
        </div>} />

      {!ok ? <Empty>The dashboard fills in as soon as the backend is reachable. Start it with <code>docker compose up -d --build</code>.</Empty> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Requests served" value={total} sub={`${req?.runs ?? 0} traffic runs`} />
            <Stat label="Success rate" value={total ? `${(((total - failed) / total) * 100).toFixed(1)}%` : '-'} tone={total && failed / total > 0.2 ? 'red' : 'green'} sub={`${failed} failed`} />
            <Stat label={`Avg latency (${minutes} min)`} value={traffic.length ? fmtMs(avg) : '-'} />
            <Stat label="p95 latency" value={traffic.length ? fmtMs(p95) : '-'} />
            <Stat label="Spans exported to Collector" value={m?.sdk.exportedSpans ?? 0} sub={m?.sdk.failedSpans ? `${m.sdk.failedSpans} failed` : 'no export failures'} tone={m?.sdk.failedSpans ? 'red' : undefined} />
            <Stat label="Spans searchable (OpenSearch)" value={m?.opensearch?.indexedSpans ?? '-'} sub={m?.opensearch?.reachable ? `cluster ${m.opensearch.clusterStatus}` : 'not reachable'} />
          </div>

          <Panel title="Telemetry pipeline" sub="How many spans reached each stage (cumulative since the backend started).">
            <div className="flex flex-wrap items-stretch gap-2">
              <Stage name="Services A → B → C" sub="spans generated (SDK)" value={String(m?.sdk.generatedTotal ?? 0)} tone={svc && Object.values(svc).every((v) => v === 'up') ? 'green' : 'red'} />
              <ArrowRight className="hidden self-center text-slate-300 md:block" size={18} />
              <Stage name="OpenTelemetry Collector" sub="received" value={c ? String(c.receivedSpans) : 'n/a'} tone={c ? 'green' : 'red'} />
              <ArrowRight className="hidden self-center text-slate-300 md:block" size={18} />
              <Stage name="Tail sampling + batching" sub={c ? `${c.batch.sends} batches · avg ${c.batch.avgBatchSize.toFixed(1)} spans` : ''} value={c ? String(c.exportedSpans) : 'n/a'} tone={c ? 'green' : 'slate'} />
              <ArrowRight className="hidden self-center text-slate-300 md:block" size={18} />
              <Stage name="OpenSearch index" sub="span documents" value={String(m?.opensearch?.indexedSpans ?? 'n/a')} tone={m?.opensearch?.reachable ? 'green' : 'red'} />
              <ArrowRight className="hidden self-center text-slate-300 md:block" size={18} />
              <Stage name="Amazon S3 archive" sub={b.cfg?.s3Configured ? 'configured' : 'not configured'} value={b.cfg?.s3Configured ? 'Ready' : 'Off'} tone={b.cfg?.s3Configured ? 'green' : 'slate'} />
            </div>
            {m?.collectorError && <p className="mt-2 text-xs text-amber-800">Collector metrics unavailable: {m.collectorError}</p>}
          </Panel>

          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
            <ChartCard title="Throughput" sub="requests per second" empty={!traffic.length}><TimeChart area data={pts} series={[{ key: 'rps', name: 'req/s', color: COLORS.blue }]} /></ChartCard>
            <ChartCard title="Latency" sub="average and p95 per interval, ms" empty={!traffic.length}><TimeChart data={pts.map((p) => ({ ...p, avgLatencyMs: p.requests ? p.avgLatencyMs : null, p95LatencyMs: p.requests ? p.p95LatencyMs : null }))} series={[{ key: 'avgLatencyMs', name: 'average', color: COLORS.violet }, { key: 'p95LatencyMs', name: 'p95', color: COLORS.amber }]} /></ChartCard>
            <ChartCard title="Error rate" sub="% of requests that failed" empty={!traffic.length}><TimeChart area unit="%" data={pts.map((p) => ({ ...p, errorRate: p.requests ? p.errorRate : null }))} series={[{ key: 'errorRate', name: 'error %', color: COLORS.red }]} /></ChartCard>
            <ChartCard title="Spans through the pipeline" sub="cumulative: generated → Collector → exported → indexed" empty={!pts.length}>
              <TimeChart data={pts} series={[{ key: 'sdkGenerated', name: 'generated', color: COLORS.slate }, { key: 'collectorReceived', name: 'collector received', color: COLORS.blue }, { key: 'collectorExported', name: 'exported', color: COLORS.violet }, { key: 'indexedSpans', name: 'indexed', color: COLORS.green }]} />
            </ChartCard>
            <ChartCard title="Tail-sampling decisions" sub="traces kept per policy (a trace can match several)" empty={!policies.length}>
              <BarsChart data={policies.map(([k, v]) => ({ name: polName(k), value: v.sampled, color: polColor(k) }))} />
            </ChartCard>
            <ChartCard title="Service health" sub="current state of the three services">
              <div className="flex h-full flex-col justify-center gap-3">
                {(['A', 'B', 'C'] as const).map((s) => (
                  <div key={s} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm"><span className="flex items-center gap-2 font-medium"><Dot tone={svc?.[s] === 'up' ? 'green' : 'red'} />Service {s}</span><span className={svc?.[s] === 'up' ? 'text-emerald-700' : 'font-semibold text-rose-700'}>{svc?.[s] === 'up' ? 'running' : 'DOWN'}</span></div>
                ))}
              </div>
            </ChartCard>
          </div>
        </>
      )}
    </div>
  );
}
