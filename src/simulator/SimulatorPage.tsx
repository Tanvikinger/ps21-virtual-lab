import { useMemo, useState } from 'react';
import { Simulator } from './engine/simulationEngine';
import { componentStats, computeMetrics, type NodeId } from './engine/metrics';
import { PRESETS, merge, DEFAULT_CONFIG } from './engine/config';
import { LabCanvas } from './components/LabCanvas';
import { NodePanel, useUpdaters } from './components/NodePanel';
import { TraceDetail, TraceTable } from './components/TraceViews';
import { MetricsPanel } from './components/Charts';
import { Empty, NumField, Stat } from './components/ui';
import type { SimEvent } from './engine/types';
import { Pause, Play, Repeat, RotateCcw, SkipForward } from 'lucide-react';
import type { SimState } from './useSimulator';

export function EventList({ events, only, limit = 80 }: { events: SimEvent[]; only?: string[]; limit?: number }) {
  const rows = (only ? events.filter((e) => only.includes(e.type) || e.level === 'error') : events).slice(-limit).reverse();
  if (!rows.length) return <Empty>No events yet. Events (requests failing, batches exported, faults, recoveries) appear here while the simulation runs.</Empty>;
  const col = { info: 'text-slate-600', warn: 'text-amber-700', error: 'text-red-700' };
  return (
    <ul className="max-h-full space-y-0.5 overflow-auto font-mono text-[11px]">
      {rows.map((e, i) => <li key={i} className={col[e.level]}><span className="text-slate-400">{(e.t / 1000).toFixed(2)}s</span> [{e.type}] {e.msg}</li>)}
    </ul>
  );
}

export function SimulatorPage({ config, setConfig, lab, errors }: SimState) {
  const [sel, setSel] = useState<NodeId | null>(null);
  const [tab, setTab] = useState<'node' | 'workload'>('node');
  const [bottom, setBottom] = useState<'traces' | 'events' | 'metrics'>('traces');
  const [traceId, setTraceId] = useState<string | null>(null);
  const { sec } = useUpdaters(setConfig);
  const { sim, metrics: m } = lab;
  const idle = useMemo(() => { const s = new Simulator(config); return componentStats(s, computeMetrics(s)); }, [config]);
  const stats = sim && m ? componentStats(sim, m) : idle;
  const t = config.traffic;
  const finished = !!sim && sim.isDone();
  const startLabel = lab.running ? 'Pause' : sim && !finished ? 'Resume' : 'Start Simulation';
  const tr = sim?.traces.find((x) => x.id === traceId) ?? null;
  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Pipeline Simulator</h1>
        <p className="text-sm text-slate-500">Configure every component, start a workload and watch requests travel through Services A→B→C while their trace data flows through the telemetry pipeline. This page is a deterministic <b>simulation</b> that runs in your browser; the other pages use the real backend.</p>
      </div>
      <div className="panel flex flex-wrap items-center gap-2">
        <button className="btn btn-primary" disabled={errors.length > 0} title={errors[0]} onClick={() => (lab.running ? lab.pause() : lab.start(config))}>{lab.running ? <Pause size={14} /> : <Play size={14} />}{startLabel}</button>
        <button className="btn btn-ghost" disabled={lab.running || finished} onClick={() => lab.step(config)} title="Advance 250 virtual ms"><SkipForward size={14} />Step</button>
        <button className="btn btn-ghost" onClick={() => { if (!sim || window.confirm('Reset the current simulation? All traces, events and metrics of this run will be cleared.')) lab.reset(); }}><RotateCcw size={14} />Reset</button>
        <button className="btn btn-ghost" disabled={errors.length > 0} onClick={() => lab.restart(config)} title="Restart with the same seed and the current settings"><Repeat size={14} />Run again (same seed)</button>
        <label className="flex items-center gap-1 text-xs text-slate-600">Speed<select className="input !w-16" value={lab.speed} onChange={(e) => lab.setSpeed(Number(e.target.value))}>{[1, 2, 5, 10, 25].map((v) => <option key={v} value={v}>{v}x</option>)}</select></label>
        <div className="ml-auto flex items-center gap-3 text-xs text-slate-600">
          <span>seed {t.seed}</span><span className="tabular-nums">virtual time {((m?.virtualTimeMs ?? 0) / 1000).toFixed(1)} s</span>
          <span className={`rounded px-2 py-0.5 font-semibold ${lab.running ? 'bg-emerald-100 text-emerald-800' : finished ? 'bg-sky-100 text-sky-800' : 'bg-slate-100 text-slate-600'}`}>{lab.running ? 'Running' : finished ? 'Finished' : sim ? 'Paused' : 'Ready'}</span>
        </div>
        {errors.length > 0 && <div className="w-full rounded bg-red-50 px-2 py-1 text-xs text-red-800">Fix before starting: {errors[0]} (see Workload below).</div>}
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Stat label="1 · Generated" value={m?.generated ?? 0} help="Requests created by the traffic generator." />
        <Stat label="Waiting (concurrency)" value={m?.waiting ?? 0} help="Generated but not yet started because the concurrency limit is reached." />
        <Stat label="2 · Processing" value={m?.processing ?? 0} help="Requests currently travelling through the services." />
        <Stat label="3a · Completed" value={m?.completed ?? 0} />
        <Stat label="3b · Failed" value={m?.failed ?? 0} />
      </div>
      <div className="grid gap-3 xl:grid-cols-[1fr_330px]">
        <LabCanvas stats={stats} selected={sel} onSelect={(id) => { setSel(id); setTab(id === 'traffic' ? 'workload' : 'node'); }} running={lab.running} />
        <div className="panel">
          <div className="mb-2 flex gap-1 text-xs">
            {(['node', 'workload'] as const).map((k) => <button key={k} className={`btn ${tab === k ? 'btn-primary' : 'btn-ghost'} !py-1`} onClick={() => setTab(k)}>{k === 'node' ? 'Selected component' : 'Workload'}</button>)}
          </div>
          {tab === 'node' ? <NodePanel id={sel} stat={sel ? stats[sel] : undefined} config={config} setConfig={setConfig} locked={!!sim && !sim.isDone()} /> : (
            <div>
              <div className="mb-2 flex flex-wrap gap-1">{Object.entries(PRESETS).map(([k, p]) => <button key={k} title={p.desc} className="btn btn-ghost !px-2 !py-0.5 text-xs" onClick={() => setConfig((c) => ({ ...merge(DEFAULT_CONFIG, p.patch), faults: c.faults }))}>{p.label}</button>)}</div>
              <div className="grid grid-cols-2 gap-x-2">
                <NumField label="Total requests" value={t.totalRequests} onChange={(v) => sec('traffic', { totalRequests: v })} />
                <NumField label="Arrival rate" suffix="req/s" value={t.arrivalRate} onChange={(v) => sec('traffic', { arrivalRate: v })} help="New requests per virtual second." />
                <NumField label="Concurrency" value={t.concurrency} onChange={(v) => sec('traffic', { concurrency: v })} help="Maximum requests being processed at once; extra requests wait." />
                <NumField label="Base latency" suffix="ms" value={t.baseLatencyMs} onChange={(v) => sec('traffic', { baseLatencyMs: v })} help="Typical work time of one service (±20% jitter)." />
                <NumField label="Error prob." step={0.01} value={t.errorProb} onChange={(v) => sec('traffic', { errorProb: v })} help="Chance that each service call fails (0.03 = 3%)." />
                <NumField label="Slow-request prob." step={0.01} value={t.slowProb} onChange={(v) => sec('traffic', { slowProb: v })} help="Chance a request has one very slow service." />
                <NumField label="Slow multiplier" suffix="x" value={t.slowMultiplier} onChange={(v) => sec('traffic', { slowMultiplier: v })} help="How much longer the slow service takes." />
                <NumField label="Random seed" value={t.seed} onChange={(v) => sec('traffic', { seed: v })} help="Same seed + same settings = identical results." />
              </div>
              {errors.length > 0 && <ul className="mt-1 list-disc rounded bg-red-50 p-2 pl-5 text-xs text-red-800">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
              {config.faults.length > 0 && <div className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-900">Scheduled faults in this configuration: {config.faults.map((f) => `${f.kind}${f.target ? ' ' + f.target : ''} ${f.startMs / 1000}-${f.endMs == null ? '∞' : f.endMs / 1000}s`).join('; ')}. <button className="underline" onClick={() => setConfig((c) => ({ ...c, faults: [] }))}>Clear</button></div>}
              <p className="mt-2 text-[11px] text-slate-500">Changes apply the next time you press Start (or Run Again).</p>
            </div>
          )}
        </div>
      </div>
      <div className="panel">
        <div className="mb-2 flex gap-1 text-xs">
          {(['traces', 'events', 'metrics'] as const).map((k) => <button key={k} className={`btn ${bottom === k ? 'btn-primary' : 'btn-ghost'} !py-1`} onClick={() => setBottom(k)}>{k === 'traces' ? 'Live trace feed' : k === 'events' ? 'Events, errors & warnings' : 'Metrics'}</button>)}
        </div>
        {bottom === 'traces' && (
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="h-72 overflow-auto"><TraceTable traces={sim?.traces ?? []} filters={false} limit={60} selectedId={traceId} onSelect={(x) => setTraceId(x.id)} /></div>
            <div className="h-72 overflow-auto">{tr ? <TraceDetail trace={tr} onClose={() => setTraceId(null)} /> : <Empty>Select a trace to see its span waterfall.</Empty>}</div>
          </div>
        )}
        {bottom === 'events' && <div className="h-72 overflow-auto"><EventList events={sim?.events ?? []} /></div>}
        {bottom === 'metrics' && <MetricsPanel m={m} series={sim?.series ?? []} />}
      </div>
    </div>
  );
}
