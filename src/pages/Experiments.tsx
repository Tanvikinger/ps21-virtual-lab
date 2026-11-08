import { useState } from 'react';
import { COMPARE_METRICS, EXPERIMENTS, observedLines, runConfig, type ExperimentDef, type RunResult } from '../engine/experiments';
import type { Config } from '../engine/types';
import { Badge, Panel } from '../components/ui';
import type { Ctx } from './ctx';

const cfgLine = (c: Config) =>
  `${c.traffic.totalRequests} req @ ${c.traffic.arrivalRate}/s · errors ${(c.traffic.errorProb * 100).toFixed(0)}% · slow ${(c.traffic.slowProb * 100).toFixed(0)}% · sampling ${c.sampling.retainErrors ? 'err ' : ''}${c.sampling.retainSlow ? 'slow ' : ''}+${c.sampling.ordinaryPct}% · batch ${c.batch.size}/${c.batch.timeoutMs} ms · collector ${c.collector.msPerTrace} ms/trace` +
  (c.faults.length ? ` · faults: ${c.faults.map((f) => `${f.kind}${f.target ?? ''} ${f.startMs / 1000}-${f.endMs == null ? '∞' : f.endMs / 1000}s`).join(', ')}` : '') +
  (!c.storage.coldAvailable ? ' · cold storage OFF' : '');

export function ExperimentsPage({ setConfig, lab, saved, go }: Ctx) {
  const [results, setResults] = useState<Record<string, RunResult[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const run = (e: ExperimentDef) => {
    setBusy(e.id);
    window.setTimeout(() => { // let the "Running" state paint first; the engine itself is synchronous and fast
      const rs = e.variants().map((v) => runConfig(v.config, v.label, `${e.title} - ${v.label}`, e.id));
      setResults((r) => ({ ...r, [e.id]: rs })); setBusy(null);
    }, 30);
  };
  return (
    <div className="space-y-3">
      <div><h1 className="text-lg font-semibold text-indigo-950">Experiments</h1><p className="text-xs text-slate-600">Each button configures the engine, runs a real simulation (every variant uses the same seed), and records the results. "Expected" is a teaching description; "Actually observed" is what the simulator measured - if they differ, the observed numbers are the truth.</p></div>
      {msg && <div className="rounded bg-emerald-50 p-2 text-xs text-emerald-900">{msg}</div>}
      {saved.error && <div className="rounded bg-red-50 p-2 text-xs text-red-800">{saved.error}</div>}
      {EXPERIMENTS.map((e) => {
        const rs = results[e.id];
        return (
          <Panel key={e.id} title={e.title} right={<button className="btn btn-primary" disabled={busy === e.id} onClick={() => run(e)}>{busy === e.id ? 'Running…' : 'Run Experiment'}</button>}>
            <p className="text-sm"><b>Objective:</b> {e.objective}</p>
            <p className="text-xs text-slate-600"><b>Expected behaviour:</b> {e.expected}</p>
            <div className="mt-1 space-y-0.5 text-[11px] text-slate-500"><b>Initial configuration:</b>{e.variants().map((v) => <div key={v.label}><Badge tone="indigo">{v.label}</Badge> {cfgLine(v.config)}</div>)}</div>
            {rs && (
              <div className="mt-3 space-y-2">
                <div className="overflow-auto"><table className="w-full text-left text-xs"><thead className="bg-indigo-50"><tr><th className="p-1">Metric</th>{rs.map((r) => <th key={r.id} className="p-1">{r.label}</th>)}</tr></thead><tbody>
                  {COMPARE_METRICS.map((m) => <tr key={m.key} className="border-t border-slate-100"><td className="p-1">{m.label} {m.unit && <span className="text-slate-400">({m.unit})</span>}</td>{rs.map((r) => <td key={r.id} className="p-1 tabular-nums">{Number(r.summary[m.key]).toFixed(Number.isInteger(r.summary[m.key]) ? 0 : 1)}</td>)}</tr>)}
                </tbody></table></div>
                <div className="rounded bg-slate-50 p-2 text-xs"><b>Actually observed:</b><ul className="list-disc pl-4">{observedLines(rs).map((l) => <li key={l}>{l}</li>)}</ul></div>
                <div className="rounded bg-violet-50 p-2 text-xs text-violet-950"><b>Why did this happen?</b><ul className="list-disc pl-4">{e.why(rs).map((l) => <li key={l}>{l}</li>)}</ul></div>
                <p className="text-xs text-indigo-900"><b>What you learned:</b> {e.learned}</p>
                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-ghost" onClick={() => { saved.add(rs); setMsg(`Saved ${rs.length} run(s) from "${e.title}". Compare them under Results & Comparison.`); }}>Save these runs</button>
                  {e.variants().map((v) => <button key={v.label} className="btn btn-ghost" onClick={() => { setConfig(() => v.config); lab.restart(v.config); go('lab'); }}>Watch live: {v.label}</button>)}
                </div>
              </div>
            )}
          </Panel>
        );
      })}
    </div>
  );
}
