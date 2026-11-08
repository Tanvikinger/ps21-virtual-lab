import { useState } from 'react';
import { TraceDetail, TraceTable } from '../components/TraceViews';
import type { Ctx } from './ctx';

export function TracesPage({ lab }: Ctx) {
  const [id, setId] = useState<string | null>(null);
  const sim = lab.sim;
  const tr = sim?.traces.find((t) => t.id === id) ?? null;
  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-lg font-semibold text-indigo-950">Live Traces</h1>
        <p className="text-xs text-slate-600">Every row is a real simulated request. It appears when generated (<b>Processing</b>), then shows its outcome, the tail-sampling decision (<b>Pending → Sampled / Dropped</b>) and whether it was <b>Indexed</b> in searchable storage. The feed stops when the simulation is paused.</p>
      </div>
      <div className="grid gap-3 xl:grid-cols-[1.1fr_1fr]">
        <div className="panel h-[620px] overflow-auto"><TraceTable traces={sim?.traces ?? []} selectedId={id} onSelect={(t) => setId(t.id)} limit={300} /></div>
        <div>{tr ? <TraceDetail trace={tr} onClose={() => setId(null)} /> : <div className="panel text-sm text-slate-500">Select a trace to open its waterfall, span details, sampling explanation and export/index/archive outcome.</div>}</div>
      </div>
    </div>
  );
}
