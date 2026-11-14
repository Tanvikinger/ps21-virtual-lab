import { useMemo, useState } from 'react';
import type { ServiceId, Trace } from '../engine/types';
import { Badge, Empty, fmtMs } from './ui';

export const statusBadge = (t: Trace) =>
  t.status === 'processing' ? <Badge tone="slate" title="Request still travelling through the services">Processing</Badge>
  : t.status === 'error' ? <Badge tone="red">Error</Badge>
  : t.slow ? <Badge tone="amber" title="Duration is above the slow-trace threshold">Slow</Badge>
  : <Badge tone="green">Success</Badge>;

export const samplingBadge = (t: Trace) => {
  const s = t.sampling;
  if (s.state === 'retained') return <Badge tone="violet" title={s.reason}>Sampled</Badge>;
  if (s.state === 'dropped') return <Badge tone="slate" title={s.reason}>Dropped</Badge>;
  if (s.state === 'pending') return <Badge tone="blue" title={s.reason}>Pending</Badge>;
  if (s.state === 'incomplete') return <Badge tone="orange" title={s.reason}>Incomplete</Badge>;
  if (s.state === 'lost') return <Badge tone="red" title={s.reason}>Lost</Badge>;
  return <span className="text-slate-300">-</span>;
};
export const indexBadge = (t: Trace) => {
  if (t.index === 'indexed') return <Badge tone="green">Indexed</Badge>;
  if (t.index === 'pending') return <Badge tone="amber">Pending</Badge>;
  if (t.index === 'failed') return <Badge tone="red">Failed</Badge>;
  if (t.export === 'queued') return <Badge tone="blue" title="Retained, waiting in the batch queue">Queued</Badge>;
  if (t.export === 'failed' || t.export === 'dropped') return <Badge tone="red" title={t.exportNote}>Not exported</Badge>;
  return <span className="text-slate-300">-</span>;
};

export function TraceTable({ traces, selectedId, onSelect, filters = true, limit = 150 }: { traces: Trace[]; selectedId?: string | null; onSelect: (t: Trace) => void; filters?: boolean; limit?: number }) {
  const [q, setQ] = useState(''); const [svc, setSvc] = useState(''); const [st, setSt] = useState(''); const [minD, setMinD] = useState(0);
  const rows = useMemo(() => {
    const out: Trace[] = [];
    for (let i = traces.length - 1; i >= 0 && out.length < limit; i--) {
      const t = traces[i];
      if (q && !t.id.includes(q.toLowerCase().trim())) continue;
      if (svc && !t.services.includes(svc as ServiceId)) continue;
      if (st === 'slow' ? !(t.slow && t.status === 'success') : st && t.status !== st) continue;
      if (minD && (t.durationMs ?? 0) < minD) continue;
      out.push(t);
    }
    return out;
  }, [traces, traces.length, q, svc, st, minD, limit]);
  return (
    <div>
      {filters && (
        <div className="mb-2 flex flex-wrap items-end gap-2 text-xs">
          <label>Trace ID<input className="input mt-0.5 w-44" placeholder="search id..." value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <label>Service<select className="input mt-0.5" value={svc} onChange={(e) => setSvc(e.target.value)}><option value="">All</option><option>A</option><option>B</option><option>C</option></select></label>
          <label>Status<select className="input mt-0.5" value={st} onChange={(e) => setSt(e.target.value)}><option value="">All</option><option value="success">Success</option><option value="slow">Slow</option><option value="error">Error</option><option value="processing">Processing</option></select></label>
          <label>Min duration (ms)<input className="input mt-0.5 w-24" type="number" min={0} value={minD} onChange={(e) => setMinD(Number(e.target.value) || 0)} /></label>
        </div>
      )}
      {!traces.length ? <Empty>No traces yet. Press <b>Start Simulation</b> and requests will appear here as they are generated.</Empty> : (
        <div className="max-h-full overflow-auto rounded border border-slate-200">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-sky-50 text-sky-900"><tr>
              {['Trace ID', 'Virtual time', 'Services', 'Duration', 'Status', 'Sampling', 'Indexing'].map((h) => <th key={h} className="px-2 py-1.5 font-semibold">{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} tabIndex={0} onClick={() => onSelect(t)} onKeyDown={(e) => e.key === 'Enter' && onSelect(t)}
                  className={`cursor-pointer border-t border-slate-100 hover:bg-sky-50 ${selectedId === t.id ? 'bg-sky-100' : ''}`}>
                  <td className="px-2 py-1 font-mono">{t.id.slice(0, 12)}…</td>
                  <td className="px-2 py-1">{(t.startMs / 1000).toFixed(2)} s</td>
                  <td className="px-2 py-1">{t.services.length ? t.services.join(' → ') : 'A → …'}</td>
                  <td className="px-2 py-1">{t.durationMs == null ? '…' : fmtMs(t.durationMs)}</td>
                  <td className="px-2 py-1">{statusBadge(t)}</td>
                  <td className="px-2 py-1">{samplingBadge(t)}</td>
                  <td className="px-2 py-1">{indexBadge(t)}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={7} className="p-4 text-center text-slate-500">No traces match these filters.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function TraceDetail({ trace, onClose }: { trace: Trace; onClose?: () => void }) {
  const done = trace.status !== 'processing';
  const total = Math.max(1, trace.durationMs ?? 1);
  const selfTime = (i: number) => { const s = trace.spans[i]; const child = trace.spans[i + 1]; return s.endMs - s.startMs - (child ? child.endMs - child.startMs : 0); };
  const slowest = done && trace.spans.length ? trace.spans.map((_, i) => i).reduce((a, b) => (selfTime(b) > selfTime(a) ? b : a), 0) : -1;
  const at = (n?: number) => (n == null ? '-' : `${(n / 1000).toFixed(3)} s`);
  return (
    <div className="panel text-xs">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div><div className="text-sm font-semibold text-slate-900">Trace detail</div><div className="break-all font-mono text-[11px] text-slate-600">{trace.id}</div></div>
        <div className="flex items-center gap-2">{statusBadge(trace)}{samplingBadge(trace)}{indexBadge(trace)}{onClose && <button className="btn btn-ghost !py-0.5" onClick={onClose}>Close</button>}</div>
      </div>
      {!done ? <Empty>This request is still in progress. Spans are recorded when the request completes.</Empty> : (
        <>
          <div className="mb-1 text-[11px] text-slate-500">Waterfall - total {fmtMs(total)}. <span className="text-amber-700">Amber</span> = slowest span (own time), <span className="text-red-700">red</span> = where the failure began.</div>
          <div className="space-y-1">
            {trace.spans.map((s, i) => {
              const left = ((s.startMs - trace.startMs) / total) * 100, w = Math.max(0.8, ((s.endMs - s.startMs) / total) * 100);
              const color = s.origin ? 'bg-red-500' : s.status === 'error' ? 'bg-red-300' : i === slowest ? 'bg-amber-500' : 'bg-sky-500';
              return (
                <div key={s.id} className="flex items-center gap-2">
                  <div className="w-28 shrink-0 truncate" style={{ paddingLeft: i * 10 }}>Service {s.service}</div>
                  <div className="relative h-5 flex-1 rounded bg-slate-100"><div className={`absolute top-0 h-5 rounded ${color}`} style={{ left: `${left}%`, width: `${Math.min(w, 100 - left)}%` }} title={`${s.name}: ${fmtMs(s.endMs - s.startMs)}`} /></div>
                  <div className="w-16 shrink-0 text-right">{fmtMs(s.endMs - s.startMs)}</div>
                </div>
              );
            })}
          </div>
          <table className="mt-3 w-full text-left">
            <thead className="text-slate-500"><tr><th>Span</th><th>Parent</th><th>Start</th><th>End</th><th>Duration</th><th>Status</th></tr></thead>
            <tbody>
              {trace.spans.map((s, i) => (
                <tr key={s.id} className="border-t border-slate-100 align-top">
                  <td className="py-1 font-mono">{s.id.slice(9)} {i === slowest && <Badge tone="amber">slowest</Badge>} {s.origin && <Badge tone="red">failure origin</Badge>}</td>
                  <td className="font-mono">{s.parentId ? s.parentId.slice(9) : 'root'}</td><td>{at(s.startMs)}</td><td>{at(s.endMs)}</td><td>{fmtMs(s.endMs - s.startMs)}</td>
                  <td>{s.status === 'ok' ? <Badge tone="green">OK</Badge> : <span><Badge tone="red">Error</Badge> <span className="text-red-700">{s.error}</span></span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <div className="rounded bg-sky-50 p-2"><b>Sampling:</b> {trace.sampling.reason}</div>
            <div className="rounded bg-blue-50 p-2">
              <b>Pipeline outcome:</b> export {trace.export}{trace.exportedAt != null && ` at ${at(trace.exportedAt)}`}{trace.exportNote && ` (${trace.exportNote})`}; index {trace.index}{trace.indexedAt != null && ` at ${at(trace.indexedAt)}`}; archive {trace.archive}{trace.archivedAt != null && ` at ${at(trace.archivedAt)}`}.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
