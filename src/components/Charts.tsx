import type { ReactNode } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtTime } from './ui';

export const COLORS = { blue: '#0284c7', violet: '#7c3aed', red: '#e11d48', amber: '#d97706', green: '#059669', slate: '#94a3b8' };

export function ChartCard({ title, sub, children, empty }: { title: string; sub?: string; children: ReactNode; empty?: boolean }) {
  return (
    <div className="card !p-3">
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
      <div className="mt-2 h-48">{empty ? <div className="flex h-full items-center justify-center rounded-lg bg-slate-50 text-xs text-slate-400">No data yet - generate some traffic</div> : children}</div>
    </div>
  );
}

const axis = { tick: { fontSize: 10, fill: '#64748b' }, stroke: '#cbd5e1' };

export function TimeChart({ data, series, area, unit }: { data: object[]; series: { key: string; name: string; color: string }[]; area?: boolean; unit?: string }) {
  const common = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
      <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(t) => fmtTime(t).slice(0, 5)} {...axis} minTickGap={40} />
      <YAxis {...axis} width={44} unit={unit} allowDecimals={false} />
      <Tooltip labelFormatter={(t) => fmtTime(t as number)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
      {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
    </>
  );
  return (
    <ResponsiveContainer width="100%" height="100%">
      {area ? (
        <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>{common}
          {series.map((s) => <Area key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} fill={s.color} fillOpacity={0.15} strokeWidth={2} isAnimationActive={false} connectNulls />)}
        </AreaChart>
      ) : (
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>{common}
          {series.map((s) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />)}
        </LineChart>
      )}
    </ResponsiveContainer>
  );
}
export function BarsChart({ data }: { data: { name: string; value: number; color: string }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="name" {...axis} interval={0} /><YAxis {...axis} width={44} allowDecimals={false} />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}>{data.map((d) => <Cell key={d.name} fill={d.color} />)}</Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
