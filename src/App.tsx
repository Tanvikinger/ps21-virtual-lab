import { useMemo, useState } from 'react';
import { Activity, BarChart3, BookOpen, Cloud, Cpu, FlaskConical, Network, Pause, Play, RotateCcw, SkipForward, Zap, Repeat } from 'lucide-react';
import { DEFAULT_CONFIG, validateConfig } from './engine/config';
import type { Config } from './engine/types';
import { useLab, useSavedRuns } from './store';
import type { Ctx, Page } from './pages/ctx';
import { LabPage } from './pages/Lab';
import { TracesPage } from './pages/Traces';
import { PipelinePage } from './pages/Pipeline';
import { FaultsPage } from './pages/Faults';
import { ExperimentsPage } from './pages/Experiments';
import { ResultsPage } from './pages/Results';
import { LearnPage } from './pages/Learn';
import { RealPage } from './pages/Real';

const NAV: { id: Page; label: string; Icon: typeof Network }[] = [
  { id: 'lab', label: 'Virtual Lab', Icon: Network }, { id: 'traces', label: 'Live Traces', Icon: Activity }, { id: 'pipeline', label: 'Pipeline Inspector', Icon: Cpu },
  { id: 'faults', label: 'Fault Injection', Icon: Zap }, { id: 'experiments', label: 'Experiments', Icon: FlaskConical }, { id: 'results', label: 'Results & Comparison', Icon: BarChart3 }, { id: 'learn', label: 'Learn the Concepts', Icon: BookOpen },
  { id: 'real', label: 'Real Telemetry (backend)', Icon: Cloud },
];

export default function App() {
  const [page, setPage] = useState<Page>('lab');
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const lab = useLab();
  const saved = useSavedRuns();
  const errors = useMemo(() => validateConfig(config), [config]);
  const ctx: Ctx = { config, setConfig, lab, saved, errors, go: setPage };
  const { sim, metrics: m } = lab;
  const finished = !!sim && sim.isDone();
  const startLabel = lab.running ? 'Pause' : sim && !finished ? 'Resume' : 'Start Simulation';
  const onMain = () => (lab.running ? lab.pause() : lab.start(config));
  const resetSim = () => { if (!sim || window.confirm('Reset the current simulation? All traces, events and metrics of this run will be cleared. Saved experiments are kept.')) lab.reset(); };
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <nav className="shrink-0 bg-indigo-950 p-2 text-indigo-100 md:w-56" aria-label="Main navigation">
        <div className="px-2 py-2"><div className="text-sm font-bold text-white">PS21 Virtual Lab</div><div className="text-[10px] leading-tight text-indigo-300">Distributed Tracing &amp; Telemetry Collector</div></div>
        <ul className="flex gap-1 overflow-x-auto md:block md:space-y-0.5">
          {NAV.map(({ id, label, Icon }) => <li key={id}><button onClick={() => setPage(id)} className={`flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-2 text-left text-sm transition ${page === id ? 'bg-violet-600 text-white' : 'hover:bg-indigo-900'}`} aria-current={page === id ? 'page' : undefined}><Icon size={16} />{label}</button></li>)}
        </ul>
        <p className="mt-4 hidden px-2 text-[10px] leading-snug text-indigo-300 md:block">Course: Advanced Cloud System Software Design. Primitives: Cloud Compute + Cold Object Storage. All pages except <b>Real Telemetry</b> are a browser simulation; <b>Real Telemetry</b> talks to the backend (real OpenTelemetry, OpenSearch, S3).</p>
      </nav>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white/95 px-3 py-2 backdrop-blur">
          {page !== 'real' && <><button className="btn btn-primary" disabled={errors.length > 0} title={errors[0]} onClick={onMain}>{lab.running ? <Pause size={14} /> : <Play size={14} />}{startLabel}</button>
          <button className="btn btn-ghost" disabled={lab.running || finished} onClick={() => lab.step(config)} title="Advance 250 virtual ms"><SkipForward size={14} />Step</button>
          <button className="btn btn-ghost" onClick={resetSim}><RotateCcw size={14} />Reset</button>
          <button className="btn btn-ghost" disabled={errors.length > 0} onClick={() => lab.restart(config)} title="Restart with the same seed and the current settings"><Repeat size={14} />Run again (same seed)</button>
          <label className="flex items-center gap-1 text-xs text-slate-600">Speed<select className="input !w-16" value={lab.speed} onChange={(e) => lab.setSpeed(Number(e.target.value))}>{[1, 2, 5, 10, 25].map((s) => <option key={s} value={s}>{s}x</option>)}</select></label>
          </>}
          <div className="ml-auto flex items-center gap-2 text-xs text-slate-600">
            {page === 'real' ? <span className="rounded bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800">REAL TELEMETRY</span> : <span className="rounded bg-violet-100 px-2 py-0.5 font-semibold text-violet-800">SIMULATED</span>}
            {page !== 'real' && <>
              <span>seed {config.traffic.seed}</span>
              <span className="tabular-nums">virtual time {((m?.virtualTimeMs ?? 0) / 1000).toFixed(1)} s</span>
              <span className={`rounded px-2 py-0.5 font-semibold ${lab.running ? 'bg-emerald-100 text-emerald-800' : finished ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-100 text-slate-600'}`}>{lab.running ? 'Running' : finished ? 'Finished' : sim ? 'Paused' : 'Ready'}</span>
            </>}
          </div>
          {page !== 'real' && errors.length > 0 && <div className="w-full rounded bg-red-50 px-2 py-1 text-xs text-red-800">Fix before starting: {errors[0]} (open Virtual Lab → Workload).</div>}
        </header>
        <main className="p-3">
          {page === 'lab' && <LabPage {...ctx} />}
          {page === 'traces' && <TracesPage {...ctx} />}
          {page === 'pipeline' && <PipelinePage {...ctx} />}
          {page === 'faults' && <FaultsPage {...ctx} />}
          {page === 'experiments' && <ExperimentsPage {...ctx} />}
          {page === 'results' && <ResultsPage {...ctx} />}
          {page === 'learn' && <LearnPage />}
          {page === 'real' && <RealPage />}
        </main>
      </div>
    </div>
  );
}
