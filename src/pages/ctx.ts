import type { Config } from '../engine/types';
import type { Lab, Saved } from '../store';

export type Page = 'lab' | 'traces' | 'pipeline' | 'faults' | 'experiments' | 'results' | 'learn' | 'real';
export interface Ctx {
  config: Config;
  setConfig: (f: (c: Config) => Config) => void;
  lab: Lab;
  saved: Saved;
  errors: string[];
  go: (p: Page) => void;
}
