import { useMemo, useState } from 'react';
import { BatchFields, SamplingFields, useUpdaters } from '../components/NodePanel';
import { Bars, Box, COL, Lines } from '../components/Charts';
import { Empty, NumField, Panel, Stat, f1, fmtMs } from '../components/ui';
import { indexBadge } from '../components/TraceViews';
import type { Ctx } from './ctx';

export function PipelinePage({ config, setConfig, lab }: Ctx) {
  const [tab, setTab] = useState<'sampling' | 'batch' | 'storage'>('sampling');
  const [q, setQ] = useState('');
  const { sec } = useUpdaters(setConfig);
  const { sim, metrics: m } = lab;
  const series = useMemo(() => (sim?.series ?? []).map((s) => ({ ...s, t: +(s.t / 1000).toFixed(2) })), [lab.ver]); // eslint-disable-line react-hooks/exhaustive-deps
  const rerun = <button className="btn btn-primary" onClick={() => lab.restart(config)}>Run again with same seed</button>;
  const indexed = (sim?.traces ?? []).filter((t) => t.index === 'indexed' && (!q || t.id.includes(q.toLowerCase()) || t.services.join('').includes(q.toUpperCase()) || t.status.includes(q.toLowerCase())));
  return (
    <div className="space-y-3">
      <div><h1 className="text-lg font-semibold text-indigo-950">Pipeline Inspector</h1><p className="text-xs text-slate-600">Tune each pipeline stage, press <b>Run again with same seed</b>, and compare what changed. The workload is identical each time, so differences come only from your settings.</p></div>
      <div className="flex gap-1">{(['sampling', 'batch', 'storage'] as const).map((k) => <button key={k} className={`btn ${tab === k ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab(k)}>{k === 'sampling' ? 'Tail Sampling' : k === 'batch' ? 'Batch Processing' : 'Searchable & Cold Storage'}</button>)}</div>
      {tab === 'sampling' && (
        <div className="grid gap-3 lg:grid-cols-[300px_1fr]">
          <Panel title="Sampling policy" right={rerun}><SamplingFields c={config} sec={sec} /></Panel>
          <div className="space-y-3">
            <p className="rounded bg-violet-50 p-2 text-xs text-violet-900">Tail sampling waits for enough information about a trace before deciding whether to keep it. This allows the system to retain important traces, such as errors and unusually slow requests. <i>This simulator models tail sampling conceptually; a real OpenTelemetry Collector has its own configuration and runtime constraints.</i></p>
            {!m || !m.generated ? <Empty>Run a simulation to see sampling results.</Empty> : (
              <>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <Stat label="Traces evaluated" value={m.evaluated} sub="retained + dropped + incomplete" />
                  <Stat label="Retained" value={m.retained} sub={`of ${m.evaluated} evaluated`} />
                  <Stat label="Dropped (policy)" value={m.dropped} sub={`of ${m.evaluated} evaluated`} />
                  <Stat label="Retention" value={`${f1(m.retentionPct)}%`} sub="retained / evaluated" />
                  <Stat label="Error traces retained" value={m.errorRetained} />
                  <Stat label="Slow traces retained" value={m.slowRetained} />
                  <Stat label="Ordinary retained" value={m.ordinaryRetained} />
                  <Stat label="Pending decision" value={m.pendingSampling} sub="not yet evaluated" />
                  <Stat label="Incomplete" value={m.incomplete} sub="spans arrived after the window" />
                  <Stat label="Lost before sampling" value={m.lost} sub="collector / buffer full" />
                </div>
                <p className="text-[11px] text-slate-500">A trace qualifying under several rules is counted once, by priority: Error → Slow → Ordinary. Retained = Error + Slow + Ordinary retained.</p>
                <Box title="Sampling decisions"><Bars data={[{ name: 'Error', value: m.errorRetained, color: COL.red }, { name: 'Slow', value: m.slowRetained, color: COL.amber }, { name: 'Ordinary', value: m.ordinaryRetained, color: COL.violet }, { name: 'Dropped', value: m.dropped, color: COL.gray }, { name: 'Incomplete', value: m.incomplete, color: '#ea580c' }, { name: 'Lost', value: m.lost, color: '#7f1d1d' }]} /></Box>
              </>
            )}
          </div>
        </div>
      )}
      {tab === 'batch' && (
        <div className="grid gap-3 lg:grid-cols-[300px_1fr]">
          <Panel title="Batch settings" right={rerun}><BatchFields c={config} sec={sec} /></Panel>
          <div className="space-y-3">
            <p className="rounded bg-blue-50 p-2 text-xs text-blue-900">Trade-off: larger batches share the fixed export cost, so there are fewer batches, but records wait longer for the batch to fill (or time out) and the queue gets deeper. Smaller batches export sooner but pay the overhead more often, which can build a backlog under heavy load.</p>
            {!m || !m.generated ? <Empty>Run a simulation to see batching results.</Empty> : (
              <>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <Stat label="Batches formed" value={m.batches} /><Stat label="Average batch size" value={f1(m.avgBatch)} />
                  <Stat label="Records waiting now" value={m.queueNow} sub={`peak ${m.maxQueue}`} /><Stat label="Avg wait before export" value={fmtMs(m.avgWaitMs)} />
                  <Stat label="Export throughput" value={`${f1(m.exportThroughput)}/s`} sub="records per virtual s" /><Stat label="Exported" value={m.exported} />
                  <Stat label="Export failures" value={m.exportFailed} sub={`${m.exportRetries} retries`} /><Stat label="Dropped (queue full)" value={m.queueDropped} />
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <Box title="Queue depth over time"><Lines data={series} lines={[{ key: 'queueDepth', name: 'records', color: COL.blue }]} /></Box>
                  <Box title="Size of the last 40 batches (records)"><Bars data={(sim?.batches ?? []).slice(-40).map((b) => ({ name: `#${b.id}`, value: b.size, color: b.reason === 'size' ? COL.indigo : COL.amber }))} /></Box>
                </div>
                <p className="text-[11px] text-slate-500">Indigo bars = flushed because the batch reached its size; amber = flushed by the timeout.</p>
              </>
            )}
          </div>
        </div>
      )}
      {tab === 'storage' && (
        <div className="grid gap-3 lg:grid-cols-[300px_1fr]">
          <Panel title="Storage settings" right={rerun}>
            <NumField label="Indexing delay" suffix="ms" value={config.storage.indexDelayMs} onChange={(v) => sec('storage', { indexDelayMs: v })} />
            <NumField label="Archive eligible after" suffix="ms" value={config.storage.archiveAfterMs} onChange={(v) => sec('storage', { archiveAfterMs: v })} />
            <NumField label="Archival interval" suffix="ms" value={config.storage.archiveIntervalMs} onChange={(v) => sec('storage', { archiveIntervalMs: v })} />
            <p className="text-[11px] text-slate-500">Use the Fault Injection page to make storage unavailable.</p>
          </Panel>
          <div className="space-y-3">
            <p className="rounded bg-indigo-50 p-2 text-xs text-indigo-900"><b>Indexing supports searching; cold storage supports archival retention.</b> A trace is only <i>Indexed</i> after its simulated indexing operation succeeds, and only <i>Archived</i> once an archive object containing it is created. Nothing here writes to real OpenSearch, AWS S3 or RustFS.</p>
            {!m || !m.generated ? <Empty>Run a simulation to see indexed and archived data.</Empty> : (
              <>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <Stat label="Indexed (searchable)" value={m.indexed} /><Stat label="Index pending" value={m.indexPending} sub={`peak ${m.peakIndexPending}`} /><Stat label="Index failed" value={m.indexFailed} />
                  <Stat label="Archive objects" value={m.archivedObjects} /><Stat label="Traces archived" value={m.archivedTraces} /><Stat label="Waiting for archive" value={m.archivePending} sub={`peak ${m.peakArchivePending}`} /><Stat label="Archive failures" value={m.archiveFailures} sub="failed write attempts" />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <Panel title="Search indexed traces">
                    <input className="input mb-2" placeholder="trace id, service letter (A/B/C) or 'error'..." value={q} onChange={(e) => setQ(e.target.value)} />
                    <div className="max-h-64 overflow-auto text-xs">{indexed.slice(-60).reverse().map((t) => <div key={t.id} className="flex justify-between border-t border-slate-100 py-0.5"><span className="font-mono">{t.id.slice(0, 16)}…</span><span>{t.services.join('→')}</span><span>{t.status}</span>{indexBadge(t)}</div>)}{!indexed.length && <p className="text-slate-500">No indexed traces match.</p>}</div>
                  </Panel>
                  <Panel title="Cold storage objects (separate from the index)">
                    <div className="max-h-64 overflow-auto text-xs">{(sim?.objects ?? []).slice().reverse().map((o) => <div key={o.id} className="flex justify-between border-t border-slate-100 py-0.5"><span className="font-mono">{o.id}</span><span>{o.count} traces</span><span>{(o.at / 1000).toFixed(1)} s</span></div>)}{!sim?.objects.length && <p className="text-slate-500">No archive objects yet.</p>}</div>
                  </Panel>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
