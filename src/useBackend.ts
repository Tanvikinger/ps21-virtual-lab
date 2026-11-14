import { useCallback, useEffect, useState } from 'react';
import { api, getApiBase, type BackendConfig, type Health, type SimulateResponse } from './realApi';

/** Connection to the backend: health + config polled every few seconds, plus the last traffic run (shared by pages). */
export function useBackend() {
  const [base, setBase] = useState(getApiBase());
  const [health, setHealth] = useState<{ ok: boolean; data?: Health; err?: string; checked: boolean }>({ ok: false, checked: false });
  const [cfg, setCfg] = useState<BackendConfig | null>(null);
  const [run, setRun] = useState<SimulateResponse | null>(null);
  const refresh = useCallback(async () => {
    try { const d = await api.health(); setHealth({ ok: true, data: d, checked: true }); api.config().then(setCfg).catch(() => {}); }
    catch (e) { setHealth({ ok: false, err: (e as Error).message, checked: true }); }
  }, []);
  useEffect(() => { refresh(); const id = setInterval(refresh, 5000); return () => clearInterval(id); }, [refresh, base]);
  return { base, setBase, health, cfg, run, setRun, refresh };
}
export type Backend = ReturnType<typeof useBackend>;
