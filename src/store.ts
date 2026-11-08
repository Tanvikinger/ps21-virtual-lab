import { useEffect, useMemo, useRef, useState } from 'react';
import { Simulator } from './engine/simulationEngine';
import { computeMetrics } from './engine/metrics';
import type { Config } from './engine/types';
import type { RunResult } from './engine/experiments';

/** Owns the live Simulator instance and the real-time timer that advances its virtual clock. */
export function useLab() {
  const ref = useRef<Simulator | null>(null);
  const [ver, setVer] = useState(0);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(2);
  const bump = () => setVer((v) => v + 1);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      const s = ref.current;
      if (!s) { setRunning(false); return; }
      s.advance(s.now + 100 * speed); // 100 ms real time = 100*speed ms virtual time
      setVer((v) => v + 1);
      if (s.isDone()) setRunning(false);
    }, 100);
    return () => window.clearInterval(id);
  }, [running, speed]);

  const sim = ref.current;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const metrics = useMemo(() => (ref.current ? computeMetrics(ref.current) : null), [ver]);

  return {
    sim, metrics, running, speed, setSpeed, ver,
    ensure(cfg: Config) { if (!ref.current) ref.current = new Simulator(cfg); bump(); return ref.current; },
    start(cfg: Config) { if (!ref.current || ref.current.isDone()) ref.current = new Simulator(cfg); setRunning(true); bump(); },
    pause() { setRunning(false); },
    step(cfg: Config) { if (!ref.current) ref.current = new Simulator(cfg); ref.current.advance(ref.current.now + 250); bump(); },
    reset() { ref.current = null; setRunning(false); bump(); },
    restart(cfg: Config) { ref.current = new Simulator(cfg); setRunning(true); bump(); },
    touch: bump,
  };
}
export type Lab = ReturnType<typeof useLab>;

const KEY = 'ps21.savedRuns.v1';
export function useSavedRuns() {
  const [runs, setRuns] = useState<RunResult[]>(() => { try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : []; } catch { return []; } });
  const [error, setError] = useState<string | null>(null);
  const persist = (next: RunResult[]) => {
    try { localStorage.setItem(KEY, JSON.stringify(next)); setError(null); }
    catch { setError('Could not write to browser storage (full or disabled). Runs are kept for this session only - use Export JSON to back them up.'); }
    setRuns(next);
  };
  return {
    runs, error,
    add: (rs: RunResult[]) => persist([...runs, ...rs]),
    remove: (id: string) => persist(runs.filter((r) => r.id !== id)),
    clear: () => persist([]),
  };
}
export type Saved = ReturnType<typeof useSavedRuns>;

export function download(name: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}
