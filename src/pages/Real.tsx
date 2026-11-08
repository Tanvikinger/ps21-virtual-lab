import { useCallback, useEffect, useRef, useState } from 'react';
import { Cloud, ExternalLink, Play, RefreshCw, Skull, HeartPulse, Archive } from 'lucide-react';
import { Badge, Empty, Field, NumField, Panel, Stat, fmtMs } from '../components/ui';
import { api, ApiError, getApiBase, setApiBase, DEFAULT_API, type ArchiveResult, type BackendConfig, type Health, type PipelineMetrics, type RealRequest, type SimulateResponse, type TraceStatus } from '../realApi';

const STATE_TONE: Record<string, string> = { indexed: 'green', pending: 'amber', not_indexed: 'slate', unknown: 'red' };
const STATE_LABEL: Record<string, string> = { indexed: 'Indexed in OpenSearch', pending: 'Pending', not_indexed: 'Not indexed (inferred)', unknown: 'Unknown' };

export function RealPage() {
  const [base, setBase] = useState(getApiBase());
  const [draft, setDraft] = useState(base);
  const [health, setHealth] = useState<{ ok: boolean; data?: Health; err?: string }>({ ok: false });
  const [cfg, setCfg] = useState<BackendConfig | null>(null);
  const [p, setP] = useState({ count: 50, concurrency: 10, errorPct: 20, slowPct: 10, failService: '' });
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<SimulateResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, TraceStatus>>({});
  const [auto, setAuto] = useState(true);
  const [metrics, setMetrics] = useState<PipelineMetrics | null>(null);
  const [arch, setArch] = useState<{ busy: boolean; res?: ArchiveResult; err?: string }>({ busy: false });
  const rounds = useRef(0);

  const refreshHealth = useCallback(async () => {
    try { const d = await api.health(); setHealth({ ok: true, data: d }); api.config().then(setCfg).catch(() => {}); }
    catch (e) { setHealth({ ok: false, err: (e as Error).message }); }
  }, []);
  useEffect(() => { refreshHealth(); const id = setInterval(refreshHealth, 5000); return () => clearInterval(id); }, [refreshHealth, base]);

  const refreshMetrics = useCallback(async () => { try { setMetrics(await api.metrics()); } catch { setMetrics(null); } }, []);
  useEffect(() => { if (health.ok) { refreshMetrics(); const id = setInterval(refreshMetrics, 6000); return () => clearInterval(id); } }, [health.ok, refreshMetrics]);

  const traces: RealRequest[] = (run?.requests ?? []).filter((r) => r.traceId);
  const checkStatus = useCallback(async () => {
    const ids = traces.slice(0, 40).map((r) => r.traceId as string); const out: Record<string, TraceStatus> = {};
    for (let i = 0; i < ids.length; i += 8) await Promise.all(ids.slice(i, i + 8).map(async (id) => { try { out[id] = await api.traceStatus(id); } catch (e) { out[id] = { traceId: id, state: 'unknown', error: (e as Error).message }; } }));
    setStatus((s) => ({ ...s, ...out }));
    return out;
  }, [run]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!run || !auto) return; rounds.current = 0;
    const id = setInterval(async () => {
      rounds.current += 1; const out = await checkStatus();
      if (rounds.current >= 10 || !Object.values(out).some((s) => s.state === 'pending' || s.state === 'unknown')) clearInterval(id);
    }, 6000);
    return () => clearInterval(id);
  }, [run, auto, checkStatus]);

  const send = async () => {
    setBusy(true); setErr(null); setStatus({}); setSel(null);
    try {
      const r = await api.simulate({ count: p.count, concurrency: p.concurrency, errorRate: p.errorPct / 100, slowRate: p.slowPct / 100, failService: (p.failService || null) as 'A' | 'B' | 'C' | null, includeSpans: p.count <= 50 });
      setRun(r); setSel(r.requests.find((x) => x.traceId)?.traceId ?? null); refreshMetrics();
    } catch (e) { setErr((e as Error).message + (e instanceof ApiError && e.body ? ` - ${JSON.stringify((e.body as { details?: unknown }).details ?? '')}` : '')); } finally { setBusy(false); }
  };
  const fault = async (kind: 'crash' | 'recover', s: string) => { try { await (kind === 'crash' ? api.crash(s) : api.recover(s)); refreshHealth(); } catch (e) { setErr((e as Error).message); } };
  const archive = async () => { setArch({ busy: true }); try { setArch({ busy: false, res: await api.archive(60) }); } catch (e) { setArch({ busy: false, err: (e as Error).message }); } };

  const selReq = traces.find((r) => r.traceId === sel);
  const spans = [...(selReq?.spans ?? [])].sort((a, b) => a.startMs - b.startMs);
  const t0 = spans.length ? Math.min(...spans.map((s) => s.startMs)) : 0; const total = spans.length ? Math.max(...spans.map((s) => s.startMs + s.durationMs)) - t0 : 1;
  const c = metrics?.collector;

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-900">
        <b>REAL telemetry mode.</b> Everything on this page comes from the running backend (real HTTP calls A → B → C, real OpenTelemetry spans, real Collector, real OpenSearch, real S3). The other pages are the <b>browser simulation</b>. If a part of the pipeline is not running, it says so here — nothing is faked.
      </div>

      <Panel title="1. Backend connection" right={<Badge tone={health.ok ? 'green' : 'red'}>{health.ok ? `Connected (${health.data?.status})` : 'Not connected'}</Badge>}>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[260px] flex-1"><Field label="API endpoint" help="Where backend/ is running. Default http://localhost:4000. Saved in this browser only."><input className="input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={DEFAULT_API} /></Field></div>
          <button className="btn btn-primary mb-2" onClick={() => { setApiBase(draft); setBase(draft.replace(/\/+$/, '')); }}>Save &amp; connect</button>
        </div>
        {health.ok ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            {(['A', 'B', 'C'] as const).map((s) => <span key={s} className="flex items-center gap-1">Service {s} <Badge tone={health.data?.services[s] === 'up' ? 'green' : 'red'}>{health.data?.services[s]}</Badge>
              {health.data?.services[s] === 'up' ? <button className="btn btn-ghost !px-1.5 !py-0.5 text-[11px]" onClick={() => fault('crash', s)} title="Closes this service's real HTTP listener"><Skull size={11} />crash</button> : <button className="btn btn-ghost !px-1.5 !py-0.5 text-[11px]" onClick={() => fault('recover', s)}><HeartPulse size={11} />recover</button>}</span>)}
            <span>uptime {health.data?.uptimeSeconds}s</span>
          </div>
        ) : <p className="text-xs text-red-700">{health.err ?? 'Checking…'} — start it with <code>docker compose up -d --build</code> (see docs/SETUP.md). If you opened the deployed Netlify site, the backend must run on your own machine and allow this origin via CORS_ORIGINS.</p>}
      </Panel>

      <Panel title="2. Send real requests through Service A → B → C" right={<button className="btn btn-primary" disabled={!health.ok || busy} onClick={send}><Play size={14} />{busy ? 'Running…' : 'Send requests'}</button>}>
        <div className="grid gap-x-3 sm:grid-cols-3 lg:grid-cols-5">
          <NumField label="Requests" value={p.count} min={1} max={2000} onChange={(v) => setP({ ...p, count: v })} help="Each request is a real HTTP call chain with a real trace." />
          <NumField label="Concurrency" value={p.concurrency} min={1} max={100} onChange={(v) => setP({ ...p, concurrency: v })} />
          <NumField label="Error injection" suffix="%" value={p.errorPct} min={0} max={100} onChange={(v) => setP({ ...p, errorPct: v })} help="Share of requests where a service really throws." />
          <NumField label="Slow requests" suffix="%" value={p.slowPct} min={0} max={100} onChange={(v) => setP({ ...p, slowPct: v })} help="Adds 600 ms inside one service." />
          <Field label="Fail only service"><select className="input" value={p.failService} onChange={(e) => setP({ ...p, failService: e.target.value })}><option value="">random</option><option>A</option><option>B</option><option>C</option></select></Field>
        </div>
        {err && <div className="mt-1 rounded bg-red-50 px-2 py-1 text-xs text-red-800">{err}</div>}
        {run && <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5"><Stat label="Requests" value={run.summary.requested} /><Stat label="OK / failed" value={`${run.summary.ok} / ${run.summary.failed}`} /><Stat label="Avg latency" value={fmtMs(run.summary.avgLatencyMs)} /><Stat label="p95 latency" value={fmtMs(run.summary.p95LatencyMs)} /><Stat label="Spans emitted" value={run.summary.spansEmitted} /></div>}
      </Panel>

      <div className="grid gap-3 xl:grid-cols-[1.1fr_1fr]">
        <Panel title="3. Real traces from this run" right={<div className="flex items-center gap-2 text-xs"><label className="flex items-center gap-1"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />auto-check</label><button className="btn btn-ghost !py-0.5" disabled={!run} onClick={checkStatus}><RefreshCw size={12} />Check pipeline status</button></div>}
          help="Status is looked up in OpenSearch. 'Not indexed' is INFERRED when the trace is absent after the settle time: usually the tail sampler dropped it (ordinary fast successful traces are sampled at ~10%).">
          {!run ? <Empty>Press <b>Send requests</b> to generate real traces.</Empty> : (
            <div className="max-h-[420px] overflow-auto"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-white text-slate-500"><tr><th className="py-1">Trace ID</th><th>Outcome</th><th>Latency</th><th>Spans</th><th>Pipeline status</th></tr></thead><tbody>
              {traces.slice(0, 300).map((r) => { const s = status[r.traceId as string]; return (
                <tr key={r.traceId} onClick={() => setSel(r.traceId)} className={`cursor-pointer border-t border-slate-100 hover:bg-indigo-50 ${sel === r.traceId ? 'bg-indigo-50' : ''}`}>
                  <td className="py-1 font-mono text-[11px]">{(r.traceId as string).slice(0, 16)}…</td>
                  <td><Badge tone={r.status === 'ok' ? 'green' : 'red'}>{r.status === 'ok' ? 'ok' : `error @ ${r.failedService}`}</Badge></td>
                  <td>{fmtMs(r.durationMs)}</td><td>{r.spanCount}</td>
                  <td>{s ? <Badge tone={STATE_TONE[s.state]} title={s.note ?? s.error}>{STATE_LABEL[s.state]}{s.state === 'indexed' ? ` · ${s.spanCount} spans` : ''}</Badge> : <span className="text-slate-400">not checked</span>}</td>
                </tr>); })}
            </tbody></table></div>)}
        </Panel>

        <Panel title="Span waterfall (real spans)" help="Spans as emitted by the OpenTelemetry SDK: SERVER spans in each service and CLIENT spans for the A→B and B→C calls. Parent-child links come from the W3C traceparent header.">
          {!selReq ? <div className="text-sm text-slate-500">Select a trace.</div> : !spans.length ? <div className="text-sm text-slate-500">Span detail is only included for runs of up to 50 requests.</div> : (
            <div className="space-y-1">
              <div className="break-all font-mono text-[11px] text-slate-600">trace {selReq.traceId}</div>
              {spans.map((s) => (
                <div key={s.spanId} className="text-[11px]">
                  <div className="flex justify-between"><span className="font-medium">{s.service} <span className="text-slate-400">{s.kind}</span> {s.origin && <Badge tone="red">origin</Badge>}</span><span>{fmtMs(s.durationMs)}</span></div>
                  <div className="relative h-3 rounded bg-slate-100"><div className={`absolute h-3 rounded ${s.status === 'error' ? 'bg-red-500' : 'bg-indigo-500'}`} style={{ left: `${((s.startMs - t0) / total) * 100}%`, width: `${Math.max((s.durationMs / total) * 100, 1)}%` }} /></div>
                  <div className="font-mono text-[10px] text-slate-400">span {s.spanId} ← parent {s.parentSpanId ?? 'none (root)'}</div>
                  {s.error && <div className="text-[10px] text-red-700">{s.error}</div>}
                </div>))}
            </div>)}
        </Panel>
      </div>

      <Panel title="4. Real pipeline metrics" right={cfg && <a className="btn btn-ghost !py-0.5 text-xs" href={cfg.dashboardsUrl} target="_blank" rel="noreferrer"><ExternalLink size={12} />Open OpenSearch Dashboards</a>} help="Read live from the backend SDK counters, the Collector's own metrics endpoint and OpenSearch.">
        {!metrics ? <Empty>Connect to the backend to see metrics.</Empty> : (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              <Stat label="Spans generated (SDK)" value={metrics.sdk.generatedTotal} /><Stat label="SDK export failed" value={metrics.sdk.failedSpans} sub={metrics.sdk.lastError ?? undefined} />
              <Stat label="Collector received" value={c?.receivedSpans ?? 'n/a'} /><Stat label="Exported after sampling+batch" value={c?.exportedSpans ?? 'n/a'} /><Stat label="Not exported (dropped)" value={c?.spansNotExported ?? 'n/a'} help="Received minus exported. Only exact once the pipeline has drained." />
              <Stat label="Avg batch size" value={c ? c.batch.avgBatchSize.toFixed(1) : 'n/a'} sub={c ? `${c.batch.sends} sends` : undefined} />
            </div>
            {c && <div className="text-xs text-slate-600"><b>Tail sampling</b> ({c.tailSampling.tracesEvaluated} traces evaluated; a trace may match several policies): {Object.entries(c.tailSampling.byPolicy).map(([k, v]) => <span key={k} className="mr-3">{k}: <b>{v.sampled}</b> kept</span>)}</div>}
            {metrics.collectorError && <div className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">Collector metrics unavailable: {metrics.collectorError}</div>}
            <div className="text-xs text-slate-600">OpenSearch: {metrics.opensearch?.reachable ? <>reachable (cluster {metrics.opensearch.clusterStatus}), <b>{metrics.opensearch.indexedSpans ?? '?'}</b> span documents indexed</> : <span className="text-red-700">not reachable — {metrics.opensearch?.error}</span>}</div>
          </div>)}
      </Panel>

      <Panel title="5. Cold storage: archive to Amazon S3" right={<button className="btn btn-primary" disabled={!health.ok || arch.busy || !cfg?.s3Configured} onClick={archive}><Archive size={14} />{arch.busy ? 'Archiving…' : 'Archive last 60 min to S3'}</button>}
        help="Reads spans back from OpenSearch, writes gzip NDJSON to your S3 bucket, then verifies the object with HeadObject.">
        <div className="text-xs text-slate-600"><Cloud size={12} className="mr-1 inline" />{cfg?.s3Configured ? <>Configured bucket: <b>{cfg.s3Bucket}</b> (prefix {cfg.s3Prefix})</> : <>S3 is <b>not configured</b> on the backend. Set <code>S3_BUCKET</code> and AWS credentials/region (docs/AWS_SETUP.md).</>}</div>
        {arch.err && <div className="mt-1 rounded bg-red-50 px-2 py-1 text-xs text-red-800">Archive failed: {arch.err}</div>}
        {arch.res && (arch.res.status === 'empty' ? <div className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">{arch.res.message}</div> : (
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5"><Stat label="Status" value={<Badge tone={arch.res.verified ? 'green' : 'red'}>{arch.res.status}</Badge>} /><Stat label="Spans / traces" value={`${arch.res.spanCount} / ${arch.res.traceCount}`} /><Stat label="Bytes uploaded" value={arch.res.bytesUploaded ?? 0} sub={`raw ${arch.res.bytesUncompressed}`} /><Stat label="Storage class" value={arch.res.storageClass} /><Stat label="Object key" value={<span className="break-all text-[11px]">{arch.res.key}</span>} /></div>))}
      </Panel>
    </div>
  );
}
