import { useEffect, useMemo, useRef, useState } from 'react';
import { Simulator } from './engine/simulationEngine';
import { computeMetrics } from './engine/metrics';
import type { Config } from './engine/types';

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

