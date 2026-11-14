import type { ReactNode } from 'react';
import { HelpCircle } from 'lucide-react';

export function Help({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex align-middle" tabIndex={0} aria-label={text}>
      <HelpCircle size={13} className="ml-1 text-slate-400" />
      <span role="tooltip" className="pointer-events-none absolute left-1/2 top-5 z-50 hidden w-60 -translate-x-1/2 rounded bg-slate-800 p-2 text-xs font-normal leading-snug text-white shadow-lg group-hover:block group-focus:block">{text}</span>
    </span>
  );
}
export function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return <label className="mb-2 block text-xs text-slate-600"><span className="font-medium text-slate-700">{label}</span>{help && <Help text={help} />}<div className="mt-0.5">{children}</div></label>;
}
export function NumField(p: { label: string; help?: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; disabled?: boolean; suffix?: string }) {
  return (
    <Field label={p.label + (p.suffix ? ` (${p.suffix})` : '')} help={p.help}>
      <input className="input" type="number" value={Number.isFinite(p.value) ? p.value : ''} step={p.step ?? 1} min={p.min} max={p.max} disabled={p.disabled}
        onChange={(e) => p.onChange(e.target.value === '' ? NaN : Number(e.target.value))} />
    </Field>
  );
}
export function Toggle(p: { label: string; help?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-700">
      <input type="checkbox" className="h-4 w-4 accent-sky-600" checked={p.checked} onChange={(e) => p.onChange(e.target.checked)} />
      {p.label}{p.help && <Help text={p.help} />}
    </label>
  );
}
const TONES: Record<string, string> = {
  green: 'bg-emerald-100 text-emerald-800', red: 'bg-red-100 text-red-800', amber: 'bg-amber-100 text-amber-800', slate: 'bg-slate-100 text-slate-600',
  indigo: 'bg-sky-100 text-sky-800', violet: 'bg-sky-100 text-sky-800', blue: 'bg-blue-100 text-blue-800', orange: 'bg-orange-100 text-orange-800',
};
export function Badge({ tone = 'slate', children, title }: { tone?: string; children: ReactNode; title?: string }) {
  return <span title={title} className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ${TONES[tone]}`}>{children}</span>;
}
export function Stat({ label, value, sub, help }: { label: string; value: ReactNode; sub?: string; help?: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5">
      <div className="text-[11px] text-slate-500">{label}{help && <Help text={help} />}</div>
      <div className="text-lg font-semibold leading-tight text-sky-900">{value}</div>
      {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
    </div>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-sky-200 bg-sky-50/40 p-6 text-center text-sm text-slate-600">{children}</div>;
}
export function Panel({ title, right, children, help }: { title?: string; right?: ReactNode; children: ReactNode; help?: string }) {
  return (
    <section className="panel">
      {(title || right) && <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold text-slate-900">{title}{help && <Help text={help} />}</h3>{right}</div>}
      {children}
    </section>
  );
}
export const fmtMs = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${n.toFixed(0)} ms`);
export const f1 = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : '0');
