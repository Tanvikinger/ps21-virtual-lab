import type { Config, ServiceId } from '../engine/types';
import type { NodeId, NodeStat } from '../engine/metrics';
import { DEFAULT_CONFIG } from '../engine/config';
import { NODE_DEFS } from './LabCanvas';
import { NumField, Toggle, Badge } from './ui';

type SetCfg = (f: (c: Config) => Config) => void;
type Sec = 'traffic' | 'collector' | 'sampling' | 'batch' | 'storage';

export function useUpdaters(setConfig: SetCfg) {
  const sec = (s: Sec, patch: Record<string, unknown>) => setConfig((c) => ({ ...c, [s]: { ...c[s], ...patch } }) as unknown as Config);
  const svc = (id: ServiceId, patch: Record<string, unknown>) => setConfig((c) => ({ ...c, services: { ...c.services, [id]: { ...c.services[id], ...patch } } }));
  return { sec, svc };
}

export function SamplingFields({ c, sec }: { c: Config; sec: ReturnType<typeof useUpdaters>['sec'] }) {
  const s = c.sampling;
  return (<>
    <Toggle label="Retain error traces" checked={s.retainErrors} onChange={(v) => sec('sampling', { retainErrors: v })} help="Always keep traces where any span failed." />
    <Toggle label="Retain slow traces" checked={s.retainSlow} onChange={(v) => sec('sampling', { retainSlow: v })} help="Always keep traces slower than the threshold below." />
    <NumField label="Slow-trace threshold" suffix="ms" value={s.slowThresholdMs} onChange={(v) => sec('sampling', { slowThresholdMs: v })} help="A trace whose total duration is at or above this is 'slow'." />
    <NumField label="Ordinary traces retained" suffix="%" value={s.ordinaryPct} min={0} max={100} onChange={(v) => sec('sampling', { ordinaryPct: v })} help="Share of normal traces kept at random (seeded, so repeatable)." />
    <NumField label="Decision wait time" suffix="ms" value={s.waitMs} onChange={(v) => sec('sampling', { waitMs: v })} help="How long the processor waits for all spans before deciding. Spans delayed longer than this make the trace 'Incomplete'." />
    <NumField label="Max pending traces" value={s.maxPending} onChange={(v) => sec('sampling', { maxPending: v })} help="Capacity of the buffer holding traces that are awaiting a decision." />
  </>);
}
export function BatchFields({ c, sec }: { c: Config; sec: ReturnType<typeof useUpdaters>['sec'] }) {
  const b = c.batch;
  return (<>
    <NumField label="Batch size" suffix="records" value={b.size} onChange={(v) => sec('batch', { size: v })} help="A batch is sent as soon as this many traces are waiting." />
    <NumField label="Batch timeout" suffix="ms" value={b.timeoutMs} onChange={(v) => sec('batch', { timeoutMs: v })} help="A partly-filled batch is flushed this long after its first record arrived." />
    <NumField label="Export processing delay" suffix="ms/batch" value={b.exportDelayMs} onChange={(v) => sec('batch', { exportDelayMs: v })} help="Fixed cost per batch (network round trip). Bigger batches share this cost." />
    <NumField label="Queue capacity" suffix="records" value={b.queueCapacity} onChange={(v) => sec('batch', { queueCapacity: v })} help="Maximum records waiting + being exported. Beyond this, new records are dropped." />
    <NumField label="Export retries" value={b.maxRetries} onChange={(v) => sec('batch', { maxRetries: v })} help="Times a failed batch is retried (exponential back-off, 200 ms x 2^n) before it is abandoned." />
  </>);
}

export function NodePanel({ id, stat, config, setConfig, locked }: { id: NodeId | null; stat?: NodeStat; config: Config; setConfig: SetCfg; locked: boolean }) {
  const { sec, svc } = useUpdaters(setConfig);
  if (!id) return <p className="text-sm text-slate-500">Click any component on the canvas to see its live counters and change its settings. Changes apply to the <b>next run</b>.</p>;
  const def = NODE_DEFS.find((d) => d.id === id)!;
  const c = config;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between"><h3 className="text-sm font-semibold text-slate-900">{def.title}</h3>{stat && <Badge tone={stat.status === 'down' ? 'red' : stat.status === 'warn' ? 'amber' : stat.status === 'ok' ? 'green' : 'slate'}>{stat.note}</Badge>}</div>
      <p className="mb-2 text-xs text-slate-500">{def.desc} {locked && <span className="text-amber-700">A run is in progress - edits apply to the next run.</span>}</p>
      {id === 'traffic' && <p className="text-xs text-slate-600">Edit traffic settings in the <b>Workload</b> tab.</p>}
      {(id === 'A' || id === 'B' || id === 'C') && (<>
        <Toggle label="Service available" checked={c.services[id].available} onChange={(v) => svc(id, { available: v })} help="Off = every call fails immediately (connection refused)." />
        <NumField label="Latency multiplier" suffix="x" step={0.1} value={c.services[id].latencyFactor} onChange={(v) => svc(id, { latencyFactor: v })} help="Multiplies the base service latency for this service only." />
        <NumField label="Extra error probability" step={0.01} min={0} max={1} value={c.services[id].errorProb} onChange={(v) => svc(id, { errorProb: v })} help="Added to the global per-call error probability (0.05 = 5%)." />
      </>)}
      {id === 'collector' && (<>
        <NumField label="Processing time per trace" suffix="ms" step={0.5} value={c.collector.msPerTrace} onChange={(v) => sec('collector', { msPerTrace: v })} help="Collector capacity = 1000 / this value traces per second." />
        <NumField label="Backlog limit" suffix="traces" value={c.collector.backlogLimit} onChange={(v) => sec('collector', { backlogLimit: v })} help="Telemetry arriving while this many traces are waiting is lost." />
      </>)}
      {id === 'tail' && (<><p className="mb-2 rounded bg-sky-50 p-2 text-xs text-sky-900">Tail sampling waits for enough information about a trace before deciding whether to keep it, so important traces (errors, slow requests) can be retained.</p><SamplingFields c={c} sec={sec} /></>)}
      {id === 'batch' && <BatchFields c={c} sec={sec} />}
      {id === 'exporter' && <><Toggle label="Exporter available" checked={c.storage.exporterAvailable} onChange={(v) => sec('storage', { exporterAvailable: v })} help="Off = exports fail and are retried, then abandoned." /><NumField label="Export retries" value={c.batch.maxRetries} onChange={(v) => sec('batch', { maxRetries: v })} /></>}
      {id === 'opensearch' && (<>
        <Toggle label="Searchable storage available" checked={c.storage.indexAvailable} onChange={(v) => sec('storage', { indexAvailable: v })} help="Off = indexing fails; records stay Pending and are retried (up to 12 attempts)." />
        <NumField label="Indexing delay" suffix="ms" value={c.storage.indexDelayMs} onChange={(v) => sec('storage', { indexDelayMs: v })} help="Time between a successful export and the trace becoming searchable." />
      </>)}
      {id === 'archival' && (<>
        <NumField label="Eligible after" suffix="ms" value={c.storage.archiveAfterMs} onChange={(v) => sec('storage', { archiveAfterMs: v })} help="A trace becomes eligible for archival this long after it was exported." />
        <NumField label="Archival interval" suffix="ms" value={c.storage.archiveIntervalMs} onChange={(v) => sec('storage', { archiveIntervalMs: v })} help="How often the worker bundles eligible traces into an object." />
      </>)}
      {id === 'cold' && <Toggle label="Cold storage available" checked={c.storage.coldAvailable} onChange={(v) => sec('storage', { coldAvailable: v })} help="Off = archive writes fail; traces stay waiting until storage returns." />}
      <button className="btn btn-ghost mt-2 text-xs" onClick={() => { if (window.confirm('Reset all architecture settings (services, collector, sampling, batching, storage) to defaults? Workload settings are kept.')) setConfig((x) => ({ ...DEFAULT_CONFIG, traffic: x.traffic, faults: [] })); }}>Reset Architecture</button>
    </div>
  );
}
