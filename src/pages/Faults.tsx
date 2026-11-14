import { useCallback, useEffect, useState } from 'react';
import { HeartPulse, Play, RotateCcw, Skull } from 'lucide-react';
import { ChartCard, COLORS, TimeChart } from '../components/Charts';
import { Badge, ErrorBox, Field, PageHeader, Panel, fmtMs } from '../components/ui';
import { api, type FaultsResponse, type HistoryPoint } from '../realApi';
import type { Backend } from '../useBackend';

const SVCS = ['A', 'B', 'C'] as const;
const SCENARIOS: { label: string; desc: string; apply: () => Promise<unknown> }[] = [
  { label: 'Crash Service B', desc: 'Service B stops answering; A reports the failure.', apply: () => api.crash('B') },
  { label: 'Slow Service C (+800 ms)', desc: 'Every request spends 800 ms longer in C.', apply: () => api.setFault('C', { extraLatencyMs: 800 }) },
  { label: '30% errors in Service A', desc: 'A fails roughly one request in three.', apply: () => api.setFault('A', { errorRate: 0.3 }) },
];

export function FaultsPage({ b }: { b: Backend }) {
  const [f, setF] = useState<FaultsResponse | null>(null);
  const [draft, setDraft] = useState<Record<string, { err: number; lat: number }>>({ A: { err: 0, lat: 0 }, B: { err: 0, lat: 0 }, C: { err: 0, lat: 0 } });
  const [pts, setPts] = useState<HistoryPoint[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [probe, setProbe] = useState<{ busy: boolean; text?: string }>({ busy: false });
  const ok = b.health.ok;

  const load = useCallback(async () => {
    try { setF(await api.faults()); setPts((await api.history(5)).points); } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { if (!ok) return; load(); const id = setInterval(load, 4000); return () => clearInterval(id); }, [ok, load]);

  const act = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); await load(); b.refresh(); } catch (e) { setErr((e as Error).message); } };
  const apply = (s: string) => act(() => api.setFault(s, { errorRate: draft[s].err / 100, extraLatencyMs: draft[s].lat }));
  const reset = () => act(async () => { await api.resetFaults(); for (const s of SVCS) if (f?.services[s] === 'down') await api.recover(s); setDraft({ A: { err: 0, lat: 0 }, B: { err: 0, lat: 0 }, C: { err: 0, lat: 0 } }); });
  const sendProbe = async () => {
    setProbe({ busy: true });
    try { const r = await api.simulate({ count: 30, concurrency: 5, errorRate: 0, slowRate: 0, failService: null, includeSpans: false }); setProbe({ busy: false, text: `${r.summary.ok} of ${r.summary.requested} succeeded · avg ${fmtMs(r.summary.avgLatencyMs)} · p95 ${fmtMs(r.summary.p95LatencyMs)}` }); load(); }
    catch (e) { setProbe({ busy: false }); setErr((e as Error).message); }
  };
  const anyFault = f && SVCS.some((s) => f.services[s] === 'down' || f.faults[s].errorRate > 0 || f.faults[s].extraLatencyMs > 0);

  return (
    <div className="space-y-4">
      <PageHeader title="Fault Injection" sub="Break the real services on purpose and watch how the telemetry captures it, then recover."
        right={<button className="btn btn-ghost" onClick={reset} disabled={!ok}><RotateCcw size={14} />Reset everything</button>} />
      {err && <ErrorBox>{err}</ErrorBox>}

      <Panel title="Quick scenarios" sub="One click to inject a failure, then press “Send 30 test requests” and look at the chart below.">
        <div className="flex flex-wrap gap-2">
          {SCENARIOS.map((s) => <button key={s.label} title={s.desc} className="btn btn-ghost" disabled={!ok} onClick={() => act(s.apply)}>{s.label}</button>)}
          <button className="btn btn-primary ml-auto" disabled={!ok || probe.busy} onClick={sendProbe}><Play size={14} />{probe.busy ? 'Sending…' : 'Send 30 test requests'}</button>
        </div>
        {probe.text && <p className="mt-2 text-xs text-slate-600">Last test: <b>{probe.text}</b></p>}
        <p className="mt-1 text-xs text-slate-500">{anyFault ? 'A fault is currently active.' : 'No faults active: the system is healthy.'}</p>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        {SVCS.map((s) => {
          const up = f?.services[s] === 'up'; const cur = f?.faults[s];
          return (
            <Panel key={s} title={`Service ${s}`} right={<Badge tone={up ? 'green' : 'red'}>{up ? 'running' : 'DOWN'}</Badge>}>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Error rate (%)"><input className="input" type="number" min={0} max={100} value={draft[s].err} onChange={(e) => setDraft({ ...draft, [s]: { ...draft[s], err: Number(e.target.value) } })} /></Field>
                <Field label="Extra latency (ms)"><input className="input" type="number" min={0} max={30000} step={100} value={draft[s].lat} onChange={(e) => setDraft({ ...draft, [s]: { ...draft[s], lat: Number(e.target.value) } })} /></Field>
              </div>
              <p className="mb-2 text-[11px] text-slate-500">Active now: {cur ? `${Math.round(cur.errorRate * 100)}% errors, +${cur.extraLatencyMs} ms` : '-'}</p>
              <div className="flex gap-2">
                <button className="btn btn-primary btn-sm" disabled={!ok} onClick={() => apply(s)}>Apply</button>
                {up ? <button className="btn btn-danger btn-sm" disabled={!ok} onClick={() => act(() => api.crash(s))}><Skull size={12} />Crash</button> : <button className="btn btn-primary btn-sm" disabled={!ok} onClick={() => act(() => api.recover(s))}><HeartPulse size={12} />Recover</button>}
              </div>
            </Panel>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Error rate (last 5 min)" sub="% of requests failing" empty={!pts.some((p) => p.requests)}><TimeChart area unit="%" data={pts.map((p) => ({ ...p, errorRate: p.requests ? p.errorRate : null }))} series={[{ key: 'errorRate', name: 'error %', color: COLORS.red }]} /></ChartCard>
        <ChartCard title="Latency (last 5 min)" sub="average and p95, ms" empty={!pts.some((p) => p.requests)}><TimeChart data={pts.map((p) => ({ ...p, avgLatencyMs: p.requests ? p.avgLatencyMs : null, p95LatencyMs: p.requests ? p.p95LatencyMs : null }))} series={[{ key: 'avgLatencyMs', name: 'average', color: COLORS.violet }, { key: 'p95LatencyMs', name: 'p95', color: COLORS.amber }]} /></ChartCard>
      </div>
    </div>
  );
}
