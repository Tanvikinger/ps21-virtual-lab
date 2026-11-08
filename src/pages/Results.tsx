import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { captureRun, compareRuns, toCSV } from '../engine/experiments';
import { Empty, Panel } from '../components/ui';
import { download } from '../store';
import type { Ctx } from './ctx';

const PAL = ['#4f46e5', '#7c3aed', '#2563eb', '#059669', '#d97706', '#dc2626'];

export function ResultsPage({ lab, saved }: Ctx) {
  const [name, setName] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const chosen = saved.runs.filter((r) => sel.includes(r.id));
  const rows = compareRuns(chosen);
  const sim = lab.sim;
  const save = () => { if (!sim) return; const n = name.trim() || `Lab run ${new Date().toLocaleTimeString()}`; saved.add([captureRun(sim, n, n)]); setName(''); };
  const chart = ['avgLatency', 'p95Latency'].map((k) => { const row = rows.find((r) => r.key === k)!; const o: Record<string, string | number> = { metric: row.label }; chosen.forEach((c, i) => { o[`${i + 1}. ${c.name}`] = +row.values[i].toFixed(1); }); return o; });
  return (
    <div className="space-y-3">
      <div><h1 className="text-lg font-semibold text-indigo-950">Results & Comparison</h1><p className="text-xs text-slate-600">Saved runs are stored in this browser (localStorage) and survive a page refresh. Comparison tables read the saved measurements - nothing is re-simulated.</p></div>
      {saved.error && <div className="rounded bg-red-50 p-2 text-xs text-red-800">{saved.error}</div>}
      <Panel title="Save the current Lab run">
        <div className="flex flex-wrap items-center gap-2"><input className="input w-64" placeholder="Name, e.g. 'Batch 50, seed 42'" value={name} onChange={(e) => setName(e.target.value)} /><button className="btn btn-primary" disabled={!sim || !lab.metrics?.generated} onClick={save}>Save run</button>
          <span className="text-xs text-slate-500">{sim ? `Current run: ${lab.metrics?.finished ?? 0} requests finished at ${((lab.metrics?.virtualTimeMs ?? 0) / 1000).toFixed(1)} s${lab.metrics?.done ? '' : ' (still running - saved as a snapshot)'}` : 'Start a simulation in the Virtual Lab first.'}</span></div>
      </Panel>
      <Panel title={`Saved runs (${saved.runs.length})`} right={<div className="flex gap-1">
        <button className="btn btn-ghost !py-0.5 text-xs" disabled={!saved.runs.length} onClick={() => download('ps21-runs.json', JSON.stringify(chosen.length ? chosen : saved.runs, null, 2), 'application/json')}>Export JSON</button>
        <button className="btn btn-ghost !py-0.5 text-xs" disabled={!chosen.length} onClick={() => download('ps21-comparison.csv', toCSV(chosen), 'text/csv')}>Export CSV (selected)</button>
        <button className="btn btn-danger !py-0.5 text-xs" disabled={!saved.runs.length} onClick={() => { if (window.confirm('Delete ALL saved experiment runs? This cannot be undone.')) { saved.clear(); setSel([]); } }}>Clear all</button></div>}>
        {!saved.runs.length ? <Empty>No saved runs yet. Run an experiment and press <b>Save these runs</b>, or save the current Lab run above.</Empty> : saved.runs.map((r) => (
          <div key={r.id} className="border-t border-slate-100 py-1 text-sm">
            <div className="flex items-center gap-2">
              <input type="checkbox" className="accent-indigo-600" aria-label={`Select ${r.name}`} checked={sel.includes(r.id)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, r.id] : s.filter((x) => x !== r.id)))} />
              <button className="flex-1 text-left font-medium text-indigo-900 hover:underline" onClick={() => setOpen(open === r.id ? null : r.id)}>{r.name}</button>
              <span className="text-xs text-slate-500">seed {r.config.traffic.seed} · {r.summary.finished} req · {r.status} · {new Date(r.ts).toLocaleString()}</span>
              <button className="text-xs text-red-700 hover:underline" onClick={() => { if (window.confirm(`Delete "${r.name}"?`)) { saved.remove(r.id); setSel((s) => s.filter((x) => x !== r.id)); } }}>Delete</button>
            </div>
            {open === r.id && <div className="ml-6 mt-1 rounded bg-slate-50 p-2 text-[11px]"><div>Faults: {r.config.faults.length ? r.config.faults.map((f) => `${f.kind}${f.target ?? ''} ${f.startMs / 1000}-${f.endMs == null ? '∞' : f.endMs / 1000}s`).join(', ') : 'none'} · sampling: errors {String(r.config.sampling.retainErrors)}, slow {String(r.config.sampling.retainSlow)} (≥{r.config.sampling.slowThresholdMs} ms), ordinary {r.config.sampling.ordinaryPct}% · batch {r.config.batch.size}/{r.config.batch.timeoutMs} ms</div><div className="mt-1 font-semibold">Recorded events (faults, recoveries, last events)</div><ul className="max-h-32 overflow-auto font-mono">{r.events.map((e, i) => <li key={i}>{(e.t / 1000).toFixed(2)}s [{e.type}] {e.msg}</li>)}</ul></div>}
          </div>
        ))}
      </Panel>
      <Panel title="Comparison" help="Select two or more saved runs above.">
        {chosen.length < 2 ? <Empty>Tick two or more saved runs to compare them side by side.</Empty> : (
          <div className="space-y-3">
            <div className="h-48"><ResponsiveContainer width="100%" height="100%"><BarChart data={chart}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="metric" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} unit=" ms" /><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />{chosen.map((c, i) => <Bar key={c.id} dataKey={`${i + 1}. ${c.name}`} fill={PAL[i % PAL.length]} isAnimationActive={false} />)}</BarChart></ResponsiveContainer></div>
            <div className="overflow-auto"><table className="w-full text-left text-xs"><thead className="bg-indigo-50"><tr><th className="p-1">Metric</th>{chosen.map((c, i) => <th key={c.id} className="p-1">{i + 1}. {c.name}</th>)}</tr></thead><tbody>
              {rows.map((r) => <tr key={r.key} className="border-t border-slate-100"><td className="p-1">{r.label} {r.unit && <span className="text-slate-400">({r.unit})</span>}</td>{r.values.map((v, i) => <td key={i} className="p-1 tabular-nums">{Number.isInteger(v) ? v : v.toFixed(1)}</td>)}</tr>)}
            </tbody></table></div>
          </div>
        )}
      </Panel>
    </div>
  );
}
