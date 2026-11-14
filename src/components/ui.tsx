import type { ReactNode } from 'react';
import { HelpCircle } from 'lucide-react';

export function Help({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex align-middle" tabIndex={0} aria-label={text}>
      <HelpCircle size={13} className="ml-1 text-slate-400" />
      <span role="tooltip" className="pointer-events-none absolute left-1/2 top-5 z-50 hidden w-60 -translate-x-1/2 rounded-lg bg-slate-800 p-2 text-xs font-normal leading-snug text-white shadow-lg group-hover:block group-focus:block">{text}</span>
    </span>
  );
}
export function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return <label className="mb-3 block text-xs text-slate-600"><span className="font-medium text-slate-700">{label}</span>{help && <Help text={help} />}<div className="mt-1">{children}</div></label>;
}
export function NumField(p: { label: string; help?: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; suffix?: string }) {
  return (
    <Field label={p.label + (p.suffix ? ` (${p.suffix})` : '')} help={p.help}>
      <input className="input" type="number" value={Number.isFinite(p.value) ? p.value : ''} min={p.min} max={p.max} step={p.step ?? 1} onChange={(e) => p.onChange(e.target.value === '' ? NaN : Number(e.target.value))} />
    </Field>
  );
}
const TONES: Record<string, string> = {
  green: 'bg-emerald-100 text-emerald-800', red: 'bg-rose-100 text-rose-800', amber: 'bg-amber-100 text-amber-800', slate: 'bg-slate-100 text-slate-600', blue: 'bg-sky-100 text-sky-800',
};
export function Badge({ tone = 'slate', children, title }: { tone?: string; children: ReactNode; title?: string }) {
  return <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONES[tone]}`}>{children}</span>;
}
export function Dot({ tone }: { tone: 'green' | 'red' | 'amber' | 'slate' }) {
  const c = { green: 'bg-emerald-500', red: 'bg-rose-500', amber: 'bg-amber-500', slate: 'bg-slate-300' }[tone];
  return <span className={`inline-block h-2 w-2 rounded-full ${c}`} />;
}
export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: string; tone?: 'red' | 'green' }) {
  return (
    <div className="card !p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-0.5 text-2xl font-semibold leading-tight ${tone === 'red' ? 'text-rose-600' : tone === 'green' ? 'text-emerald-600' : 'text-slate-900'}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">{children}</div>;
}
export function Panel({ title, right, children, help, sub }: { title?: string; right?: ReactNode; children: ReactNode; help?: string; sub?: string }) {
  return (
    <section className="card">
      {(title || right) && <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold text-slate-900">{title}{help && <Help text={help} />}</h3>{sub && <p className="text-xs text-slate-500">{sub}</p>}</div>{right}</div>}
      {children}
    </section>
  );
}
export function PageHeader({ title, sub, right }: { title: string; sub: string; right?: ReactNode }) {
  return <div className="flex flex-wrap items-end justify-between gap-2"><div><h1 className="text-xl font-semibold text-slate-900">{title}</h1><p className="text-sm text-slate-500">{sub}</p></div>{right}</div>;
}
export function ErrorBox({ children }: { children: ReactNode }) { return <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">{children}</div>; }
export function Note({ children }: { children: ReactNode }) { return <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{children}</div>; }

export const fmtMs = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${Math.round(n)} ms`);
export const fmtBytes = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);
export const fmtTime = (t: number | string) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
