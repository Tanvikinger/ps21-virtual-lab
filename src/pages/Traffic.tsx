import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, RefreshCw } from 'lucide-react';
import { Badge, Empty, ErrorBox, Field, NumField, PageHeader, Panel, Stat, fmtMs } from '../components/ui';
import { api, ApiError, type RealRequest, type TraceStatus } from '../realApi';
import type { Backend } from '../useBackend';

const TONE: Record<string, string> = { indexed: 'green', pending: 'amber', not_indexed: 'slate', unknown: 'red' };
const LABEL: Record<string, string> = { indexed: 'Stored in OpenSearch', pending: 'In pipeline', not_indexed: 'Sampled out', unknown: 'Unknown' };

export function TrafficPage({ b }: { b: Backend }) {
  const { run, setRun, health } = b;
  const [p, setP] = useState({ count: 50, concurrency: 10, errorPct: 20, slowPct: 10, failService: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, TraceStatus>>({});
  const [filter, setFilter] = useState<'all' | 'error' | 'ok'>('all');
  const rounds = useRef(0);

  const traces: RealRequest[] = (run?.requests ?? []).filter((r) => r.traceId);
  const shown = traces.filter((r) => filter === 'all' || r.status === filter);

  const check = useCallback(async () => {
    const ids = traces.slice(0, 40).map((r) => r.traceId as string); const out: Record<string, TraceStatus> = {};
    for (let i = 0; i < ids.length; i += 8) await Promise.all(ids.slice(i, i + 8).map(async (id) => { try { out[id] = await api.traceStatus(id); } catch (e) { out[id] = { traceId: id, state: 'unknown', error: (e as Error).message }; } }));
    setStatus((s) => ({ ...s, ...out })); return out;
  }, [run]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { // poll until every trace is either stored or confirmed sampled out
    if (!run) return; rounds.current = 0;
    const id = setInterval(async () => { rounds.current += 1; const out = await check(); if (rounds.current >= 10 || !Object.values(out).some((s) => s.state === 'pending' || s.state === 'unknown')) clearInterval(id); }, 6000);
    return () => clearInterval(id);
  }, [run, check]);

  const send = async () => {
    setBusy(true); setErr(null); setStatus({}); setSel(null);
    try {
      const r = await api.simulate({ count: p.count, concurrency: p.concurrency, errorRate: p.errorPct / 100, slowRate: p.slowPct / 100, failService: (p.failService || null) as 'A' | 'B' | 'C' | null, includeSpans: p.count <= 50 });
      setRun(r); setSel(r.requests.find((x) => x.traceId)?.traceId ?? null);
    } catch (e) { setErr((e as Error).message + (e instanceof ApiError && e.body ? ` - ${JSON.stringify((e.body as { details?: unknown }).details ?? '')}` : '')); } finally { setBusy(false); }
  };

  const selReq = traces.find((r) => r.traceId === sel);
  const spans = [...(selReq?.spans ?? [])].sort((a, z) => a.startMs - z.startMs);
  const t0 = spans.length ? Math.min(...spans.map((s) => s.startMs)) : 0;
  const total = spans.length ? Math.max(...spans.map((s) => s.startMs + s.durationMs)) - t0 : 1;
  const st = sel ? status[sel] : undefined;

  return (
    <div className="space-y-4">
      <PageHeader title="Traffic & Traces" sub="Send real requests through Service A → B → C and inspect the distributed trace each one produces." />
      <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
        <Panel title="Generate traffic" right={<button className="btn btn-primary" disabled={!health.ok || busy} onClick={send}><Play size={14} />{busy ? 'Running…' : 'Send requests'}</button>}>
          <NumField label="Requests" value={p.count} min={1} max={2000} onChange={(v) => setP({ ...p, count: v })} help="Each request is a real HTTP call chain with its own trace." />
          <NumField label="Concurrency" value={p.concurrency} min={1} max={100} onChange={(v) => setP({ ...p, concurrency: v })} help="Requests in flight at the same time." />
          <NumField label="Failing requests" suffix="%" value={p.errorPct} min={0} max={100} onChange={(v) => setP({ ...p, errorPct: v })} help="Share of requests where a service really throws an error." />
          <NumField label="Slow requests" suffix="%" value={p.slowPct} min={0} max={100} onChange={(v) => setP({ ...p, slowPct: v })} help="Share of requests where one service is delayed by 600 ms." />
          <Field label="Failures originate in"><select className="input" value={p.failService} onChange={(e) => setP({ ...p, failService: e.target.value })}><option value="">any service (random)</option><option value="A">Service A</option><option value="B">Service B</option><option value="C">Service C</option></select></Field>
          {err && <ErrorBox>{err}</ErrorBox>}
          {!health.ok && <p className="text-xs text-rose-700">Backend not connected.</p>}
          {run && <div className="mt-3 grid grid-cols-2 gap-2"><Stat label="Succeeded" value={run.summary.ok} tone="green" /><Stat label="Failed" value={run.summary.failed} tone={run.summary.failed ? 'red' : undefined} /><Stat label="Avg latency" value={fmtMs(run.summary.avgLatencyMs)} /><Stat label="p95 latency" value={fmtMs(run.summary.p95LatencyMs)} /></div>}
        </Panel>

        <div className="space-y-4">
          <Panel title="Traces" sub="Every row is one request. Storage status is looked up in OpenSearch; ordinary fast, successful traces are sampled at ~10%, so many show 'Sampled out' by design."
            right={<div className="flex items-center gap-2"><div className="flex rounded-lg border border-slate-300 bg-white p-0.5 text-xs">{(['all', 'error', 'ok'] as const).map((f) => <button key={f} onClick={() => setFilter(f)} className={`rounded-md px-2.5 py-1 capitalize ${filter === f ? 'bg-sky-600 text-white' : 'text-slate-600'}`}>{f === 'ok' ? 'success' : f === 'error' ? 'errors' : 'all'}</button>)}</div><button className="btn btn-ghost btn-sm" disabled={!run} onClick={check}><RefreshCw size={12} />Refresh status</button></div>}>
            {!run ? <Empty>No traffic yet. Press <b>Send requests</b>.</Empty> : (
              <div className="max-h-[340px] overflow-auto"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-white text-slate-500"><tr><th className="py-1.5">Trace ID</th><th>Result</th><th>Latency</th><th>Spans</th><th>Storage</th></tr></thead><tbody>
                {shown.slice(0, 300).map((r) => { const s = status[r.traceId as string]; return (
                  <tr key={r.traceId} onClick={() => setSel(r.traceId)} className={`cursor-pointer border-t border-slate-100 hover:bg-sky-50 ${sel === r.traceId ? 'bg-sky-50' : ''}`}>
                    <td className="py-1.5 font-mono text-[11px]">{(r.traceId as string).slice(0, 16)}…</td>
                    <td><Badge tone={r.status === 'ok' ? 'green' : 'red'}>{r.status === 'ok' ? 'success' : `error in ${r.failedService}`}</Badge></td>
                    <td>{fmtMs(r.durationMs)}</td><td>{r.spanCount}</td>
                    <td>{s ? <Badge tone={TONE[s.state]} title={s.note ?? s.error}>{LABEL[s.state]}</Badge> : <span className="text-slate-400">checking…</span>}</td>
                  </tr>); })}
              </tbody></table></div>)}
          </Panel>

          <Panel title="Trace detail" sub={selReq ? `trace ${selReq.traceId}` : undefined} right={st && <Badge tone={TONE[st.state]}>{LABEL[st.state]}{st.state === 'indexed' ? ` · ${st.spanCount} spans` : ''}</Badge>}>
            {!selReq ? <Empty>Select a trace above to see its span waterfall.</Empty> : !spans.length ? <Empty>Span detail is included for runs of up to 50 requests.</Empty> : (
              <div className="space-y-2">
                {spans.map((s) => (
                  <div key={s.spanId} className="text-xs">
                    <div className="flex justify-between"><span className="font-medium text-slate-800">{s.name} <span className="text-slate-400">{s.kind.toLowerCase()}</span> {s.origin && <Badge tone="red">root cause</Badge>}</span><span className="text-slate-600">{fmtMs(s.durationMs)}</span></div>
                    <div className="relative mt-0.5 h-3.5 rounded bg-slate-100"><div className={`absolute h-3.5 rounded ${s.status === 'error' ? 'bg-rose-500' : 'bg-sky-500'}`} style={{ left: `${((s.startMs - t0) / total) * 100}%`, width: `${Math.max((s.durationMs / total) * 100, 1)}%` }} /></div>
                    {s.error && <div className="mt-0.5 text-[11px] text-rose-700">{s.error}</div>}
                  </div>))}
                {st?.note && <p className="text-[11px] text-slate-500">{st.note}</p>}
              </div>)}
          </Panel>
        </div>
      </div>
    </div>
  );
}
