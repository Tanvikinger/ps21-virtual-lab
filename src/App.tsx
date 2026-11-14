import { useState } from 'react';
import { Activity, Cloud, Cpu, LayoutDashboard, Settings, Zap } from 'lucide-react';
import { BRAND } from './brand';
import { Badge } from './components/ui';
import { DEFAULT_API, setApiBase } from './realApi';
import { useBackend } from './useBackend';
import { DashboardPage } from './pages/Dashboard';
import { TrafficPage } from './pages/Traffic';
import { FaultsPage } from './pages/Faults';
import { CloudPage } from './pages/Cloud';
import { SimulatorPage } from './simulator/SimulatorPage';
import { useSimulator } from './simulator/useSimulator';

type Page = 'dashboard' | 'simulator' | 'traffic' | 'faults' | 'cloud';
const NAV = [
  { id: 'dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { id: 'simulator', label: 'Pipeline Simulator', Icon: Cpu },
  { id: 'traffic', label: 'Traffic & Traces', Icon: Activity },
  { id: 'faults', label: 'Fault Injection', Icon: Zap },
  { id: 'cloud', label: 'AWS Cloud', Icon: Cloud },
] as const;

export default function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [showCfg, setShowCfg] = useState(false);
  const b = useBackend();
  const sim = useSimulator();
  const [draft, setDraft] = useState(b.base);
  const h = b.health;
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <nav className="shrink-0 bg-slate-900 p-3 text-slate-200 md:w-60" aria-label="Main navigation">
        <div className="mb-4 flex items-center gap-2 px-2 py-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500 text-lg font-bold text-white">T</div>
          <div><div className="text-base font-semibold leading-tight text-white">{BRAND.name}</div><div className="text-[10px] leading-tight text-slate-400">{BRAND.tagline}</div></div>
        </div>
        <ul className="flex gap-1 overflow-x-auto md:block md:space-y-1">
          {NAV.map(({ id, label, Icon }) => (
            <li key={id}><button onClick={() => setPage(id)} aria-current={page === id ? 'page' : undefined} className={`flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2.5 text-left text-sm transition ${page === id ? 'bg-sky-600 text-white' : 'text-slate-300 hover:bg-slate-800'}`}><Icon size={17} />{label}</button></li>
          ))}
        </ul>
        <div className="mt-6 hidden px-2 text-[11px] leading-snug text-slate-500 md:block">OpenTelemetry · OpenSearch<br />Amazon S3 · Amazon CloudWatch<br />Docker</div>
      </nav>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex items-center justify-end gap-3 border-b border-slate-200 bg-white/90 px-4 py-2 backdrop-blur">
          <Badge tone={!h.checked ? 'slate' : h.ok ? (h.data?.status === 'ok' ? 'green' : 'amber') : 'red'}>{!h.checked ? 'connecting…' : h.ok ? (h.data?.status === 'ok' ? 'System healthy' : 'Degraded - a service is down') : 'Backend offline'}</Badge>
          {h.ok && <span className="hidden text-xs text-slate-500 sm:inline">uptime {Math.floor((h.data?.uptimeSeconds ?? 0) / 60)} min</span>}
          <button className="btn btn-ghost btn-sm" onClick={() => setShowCfg((v) => !v)} aria-label="Connection settings"><Settings size={13} /></button>
        </header>
        {showCfg && (
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs">
            <div className="flex flex-wrap items-end gap-2"><label className="min-w-[260px] flex-1">Backend URL<input className="input mt-1" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={DEFAULT_API || 'same server'} /></label>
              <button className="btn btn-primary" onClick={() => { setApiBase(draft); b.setBase(draft.replace(/\/+$/, '')); setShowCfg(false); }}>Save</button></div>
            <p className="mt-1 text-slate-500">Leave empty when the backend serves this page itself. During development use http://localhost:4000.</p>
          </div>
        )}
        {h.checked && !h.ok && <div className="m-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">Cannot reach the backend ({h.err}). Start it with <code>docker compose up -d --build</code>.</div>}
        <main className="p-4">
          {page === 'dashboard' && <DashboardPage b={b} />}
          {page === 'simulator' && <SimulatorPage {...sim} />}
          {page === 'traffic' && <TrafficPage b={b} />}
          {page === 'faults' && <FaultsPage b={b} />}
          {page === 'cloud' && <CloudPage b={b} />}
        </main>
      </div>
    </div>
  );
}
