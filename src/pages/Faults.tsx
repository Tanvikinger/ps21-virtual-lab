import { useState } from 'react';
import { FAULT_LABELS, describeFault } from '../engine/simulationEngine';
import { componentStats } from '../engine/metrics';
import type { FaultKind, ServiceId } from '../engine/types';
import { Badge, Empty, Field, NumField, Panel, Stat } from '../components/ui';
import { EventList } from './Lab';
import type { Ctx } from './ctx';

const MAG: Partial<Record<FaultKind, { label: string; def: number; help: string; step: number }>> = {
  service_latency: { label: 'Latency multiplier (x)', def: 5, help: 'The service takes this many times longer.', step: 1 },
  service_errors: { label: 'Added error probability', def: 0.5, help: '0.5 = 50% extra chance each call fails.', step: 0.1 },
  collector_slow: { label: 'Slowdown factor (x)', def: 40, help: 'Collector processing time per trace is multiplied by this.', step: 5 },
  queue_saturation: { label: 'Reduced queue capacity (records)', def: 5, help: 'The batch queue can only hold this many records.', step: 1 },
};

export function FaultsPage({ config, lab }: Ctx) {
  const [kind, setKind] = useState<FaultKind>('service_down');
  const [target, setTarget] = useState<ServiceId>('B');
  const [dur, setDur] = useState<number>(NaN);
  const [mag, setMag] = useState<number>(NaN);
  const { sim, metrics: m } = lab;
  const isSvc = kind.startsWith('service_');
  const mg = MAG[kind];
  const inject = () => {
    const s = lab.ensure(config);
    s.addFault({ kind, target: isSvc ? target : undefined, startMs: s.now, endMs: Number.isFinite(dur) && dur > 0 ? s.now + dur * 1000 : null, magnitude: mg ? (Number.isFinite(mag) ? mag : mg.def) : undefined });
    lab.touch();
  };
  const active = (sim?.faults ?? []).filter((f) => f.endMs == null || f.endMs > sim!.now);
  const stats = sim && m ? componentStats(sim, m) : null;
  const rec = m ? {
    recovered: [m.peakIndexPending > 0 && m.indexPending === 0 && m.indexFailed === 0 && `Index backlog (peak ${m.peakIndexPending}) fully drained.`, m.peakArchivePending > 0 && m.archivePending === 0 && `Archive backlog (peak ${m.peakArchivePending}) written to cold storage.`, m.exportRetries > 0 && m.exportFailed === 0 && `${m.exportRetries} export retries succeeded; no batch abandoned.`].filter(Boolean) as string[],
    pending: [m.indexPending > 0 && `${m.indexPending} traces waiting to be indexed.`, m.archivePending > 0 && `${m.archivePending} traces waiting for cold storage.`, m.queueNow > 0 && `${m.queueNow} records in the export queue.`, m.pendingSampling > 0 && `${m.pendingSampling} traces awaiting a sampling decision.`].filter(Boolean) as string[],
    lost: [m.failed > 0 && `${m.failed} requests failed (no retry on the request path - not recovered).`, m.lost > 0 && `${m.lost} traces' telemetry lost before sampling.`, m.incomplete > 0 && `${m.incomplete} traces incomplete (spans too late).`, m.queueDropped > 0 && `${m.queueDropped} records dropped: queue full.`, m.exportFailed > 0 && `${m.exportFailed} records lost: export retries exhausted.`, m.indexFailed > 0 && `${m.indexFailed} traces not searchable: indexing retries exhausted.`].filter(Boolean) as string[],
  } : null;
  return (
    <div className="space-y-3">
      <div><h1 className="text-lg font-semibold text-indigo-950">Fault Injection Lab</h1><p className="text-xs text-slate-600">Break a component while the simulation runs, watch what changes, then remove the fault and see what recovers. Only mechanisms that exist in the model happen: export retries (3, with back-off), index retries (12 attempts), a bounded queue, and periodic archive retries. The request path has no retries.</p></div>
      <div className="grid gap-3 lg:grid-cols-[320px_1fr]">
        <Panel title="Inject a fault">
          <Field label="Component / fault"><select className="input" value={kind} onChange={(e) => { setKind(e.target.value as FaultKind); setMag(NaN); }}>{(Object.keys(FAULT_LABELS) as FaultKind[]).map((k) => <option key={k} value={k}>{FAULT_LABELS[k]}</option>)}</select></Field>
          {isSvc && <Field label="Service"><select className="input" value={target} onChange={(e) => setTarget(e.target.value as ServiceId)}><option>A</option><option>B</option><option>C</option></select></Field>}
          {mg && <NumField label={mg.label} help={mg.help} step={mg.step} value={Number.isFinite(mag) ? mag : mg.def} onChange={setMag} />}
          <NumField label="Duration" suffix="virtual s, blank = until removed" value={dur} onChange={setDur} />
          <button className="btn btn-danger w-full" onClick={inject}>Inject fault now</button>
          {!sim && <p className="mt-2 text-[11px] text-slate-500">No run yet: the fault is armed on a fresh paused run. Press <b>Start Simulation</b> to begin.</p>}
          {sim && !lab.running && !sim.isDone() && <p className="mt-2 text-[11px] text-amber-700">The simulation is paused; the fault takes effect once it resumes.</p>}
        </Panel>
        <div className="space-y-3">
          <Panel title="Active and scheduled faults">
            {!active.length ? <Empty>No active faults. Inject one on the left while a simulation is running.</Empty> : active.map((f) => (
              <div key={f.id} className="flex items-center justify-between border-t border-slate-100 py-1 text-sm"><span><Badge tone="red">{f.startMs > sim!.now ? 'scheduled' : 'ACTIVE'}</Badge> {describeFault(f)} <span className="text-xs text-slate-500">from {(f.startMs / 1000).toFixed(1)} s{f.endMs != null ? ` to ${(f.endMs / 1000).toFixed(1)} s` : ' until removed'}</span></span><button className="btn btn-ghost !py-0.5 text-xs" onClick={() => { sim!.removeFault(f.id); lab.touch(); }}>Remove fault</button></div>
            ))}
            {stats && <div className="mt-2 flex flex-wrap gap-1 text-[11px]">{(Object.keys(stats) as (keyof typeof stats)[]).map((k) => <Badge key={k} tone={stats[k].status === 'down' ? 'red' : stats[k].status === 'warn' ? 'amber' : 'slate'}>{k}: {stats[k].status}</Badge>)}</div>}
          </Panel>
          <Panel title="Fault timeline"><div className="h-40 overflow-auto"><EventList events={sim?.events ?? []} only={['fault', 'recovery', 'export', 'index', 'archive']} /></div></Panel>
        </div>
      </div>
      <Panel title="Recovery Summary" help="Computed from the current run's recorded outcomes.">
        {!m || !m.generated ? <Empty>Run a simulation and inject a fault to see what recovered, what is still pending and what was lost.</Empty> : (
          <div className="grid gap-3 md:grid-cols-3 text-xs">
            {([['Recovered', 'bg-emerald-50 text-emerald-900', rec!.recovered, 'Nothing has needed recovery yet.'], ['Still pending', 'bg-amber-50 text-amber-900', rec!.pending, 'Nothing pending.'], ['Lost / not recovered', 'bg-red-50 text-red-900', rec!.lost, 'Nothing lost so far.']] as const).map(([t, c, items, none]) => (
              <div key={t} className={`rounded p-2 ${c}`}><div className="mb-1 font-semibold">{t}</div>{items.length ? <ul className="list-disc pl-4">{items.map((i) => <li key={i}>{i}</li>)}</ul> : <p>{none}</p>}</div>
            ))}
          </div>
        )}
        {m && m.generated > 0 && <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-6"><Stat label="Request failures" value={m.failed} /><Stat label="Spans generated" value={m.spans} /><Stat label="Incomplete traces" value={m.incomplete} /><Stat label="Peak queue" value={m.maxQueue} /><Stat label="Export success" value={`${m.exportSuccessRate.toFixed(0)}%`} /><Stat label="Indexed / archived" value={`${m.indexed} / ${m.archivedTraces}`} /></div>}
      </Panel>
    </div>
  );
}
