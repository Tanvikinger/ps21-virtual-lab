import { useMemo, useState } from 'react';
import { DEFAULT_CONFIG, validateConfig } from './engine/config';
import type { Config } from './engine/types';
import { useLab } from './store';

/** Simulator state lives in App so a running simulation keeps going while you look at other pages. */
export function useSimulator() {
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const lab = useLab();
  const errors = useMemo(() => validateConfig(config), [config]);
  return { config, setConfig, lab, errors };
}
export type SimState = ReturnType<typeof useSimulator>;
