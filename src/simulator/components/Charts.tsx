import type { ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { SeriesPoint, Summary } from '../engine/types';
import { Empty, Help, Stat, f1, fmtMs } from './ui';

const COL = { indigo: '#4f46e5', violet: '#7c3aed', blue: '#2563eb', red: '#dc2626', amber: '#d97706', green: '#059669', gray: '#94a3b8' };

function Box({ title, help, children }: { title: string; help?: string; children: ReactNode }) {
  return <div className="rounded-lg border border-slate-200 bg-white p-2"><div className="mb-1 text-xs font-semibold text-slate-900">{title}{help && <Help text={help} />}</div><div className="h-36">{children}</div></div>;
}
function Lines({ data, lines }: { data: object[]; lines: { key: string; name: string; color: string }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="t" tick={{ fontSize: 10 }} unit="s" /><YAxis tick={{ fontSize: 10 }} /><Tooltip contentStyle={{ fontSize: 11 }} />
      {lines.length > 1 && <Legend wrapperStyle={{ fontSize: 10 }} />}
      {lines.map((l) => <Line key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={l.color} dot={false} strokeWidth={2} isAnimationActive={false} />)}
    </LineChart></ResponsiveContainer>
  );
}
function Bars({ data }: { data: { name: string; value: number; color: string }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%"><BarChart data={data} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} /><YAxis tick={{ fontSize: 10 }} allowDecimals={false} /><Tooltip contentStyle={{ fontSize: 11 }} />
      <Bar dataKey="value" isAnimationActive={false}>{data.map((d) => <Cell key={d.name} fill={d.color} />)}</Bar>
    </BarChart></ResponsiveContainer>
  );
}

export function MetricsPanel({ m, series }: { m: Summary | null; series: SeriesPoint[] }) {
  if (!m || m.generated === 0) return <Empty>No data yet. Press <b>Start Simulation</b> (top bar) - every number and chart here is computed from simulated events.</Empty>;
  const data = series.map((s) => ({ ...s, t: +(s.t / 1000).toFixed(2), avgLatency: +s.avgLatency.toFixed(1), errorRate: +s.errorRate.toFixed(1), throughput: +s.throughput.toFixed(1) }));
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
        <Stat label="Requests generated" value={m.generated} />
        <Stat label="Requests completed" value={m.finished} sub={`${m.completed} ok / ${m.failed} failed`} />
        <Stat label="Throughput" value={`${f1(m.throughput)}/s`} sub="finished requests / virtual s" />
        <Stat label="Avg latency" value={fmtMs(m.avgLatency)} sub="finished requests" />
        <Stat label="p95 latency" value={fmtMs(m.p95Latency)} help="95th percentile, nearest-rank method: sort durations, take the value at rank ceil(0.95 x n)." />
        <Stat label="Error rate" value={`${f1(m.errorRate)}%`} sub="failed / finished" />
        <Stat label="Traces / spans" value={`${m.traces} / ${m.spans}`} />
        <Stat label="Retained / dropped" value={`${m.retained} / ${m.dropped}`} sub={`of ${m.evaluated} evaluated`} />
        <Stat label="Batches (avg size)" value={`${m.batches} (${f1(m.avgBatch)})`} />
        <Stat label="Queue depth" value={m.queueNow} sub={`peak ${m.maxQueue}`} />
        <Stat label="Export success" value={`${f1(m.exportSuccessRate)}%`} sub="exported / (exported+failed+dropped)" />
        <Stat label="Indexed / archived objs" value={`${m.indexed} / ${m.archivedObjects}`} />
      </div>
      <div className="grid gap-2 lg:grid-cols-3">
        <Box title="Request throughput (req/s)"><Lines data={data} lines={[{ key: 'throughput', name: 'req/s', color: COL.indigo }]} /></Box>
        <Box title="Latency (ms, avg per 250 ms window)"><Lines data={data} lines={[{ key: 'avgLatency', name: 'avg ms', color: COL.violet }]} /></Box>
        <Box title="Error rate (% per window)"><Lines data={data} lines={[{ key: 'errorRate', name: '%', color: COL.red }]} /></Box>
        <Box title="Sampling decisions" help="Each trace counted once. 'Lost' = rejected before a decision.">
          <Bars data={[{ name: 'Error', value: m.errorRetained, color: COL.red }, { name: 'Slow', value: m.slowRetained, color: COL.amber }, { name: 'Ordinary', value: m.ordinaryRetained, color: COL.violet }, { name: 'Dropped', value: m.dropped, color: COL.gray }, { name: 'Incompl.', value: m.incomplete, color: '#ea580c' }, { name: 'Lost', value: m.lost, color: '#7f1d1d' }]} />
        </Box>
        <Box title="Queue depth over time" help="Batch queue = records waiting to be exported. Collector backlog = traces waiting to be processed."><Lines data={data} lines={[{ key: 'queueDepth', name: 'batch queue', color: COL.blue }, { key: 'collectorBacklog', name: 'collector backlog', color: COL.amber }]} /></Box>
        <Box title="Export, indexing & archival outcomes">
          <Bars data={[{ name: 'Exported', value: m.exported, color: COL.green }, { name: 'Exp.fail', value: m.exportFailed + m.queueDropped, color: COL.red }, { name: 'Indexed', value: m.indexed, color: COL.indigo }, { name: 'Idx pend.', value: m.indexPending, color: COL.amber }, { name: 'Idx fail', value: m.indexFailed, color: COL.red }, { name: 'Archived', value: m.archivedTraces, color: COL.blue }]} />
        </Box>
      </div>
    </div>
  );
}
export { Bars, Lines, Box, COL };
