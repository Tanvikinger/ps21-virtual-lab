import { useCallback, useEffect, useState } from 'react';
import { Archive, BellRing, Cloud, ExternalLink, RefreshCw, Send } from 'lucide-react';
import { ChartCard, COLORS, TimeChart } from '../components/Charts';
import { Badge, Empty, ErrorBox, Note, PageHeader, Panel, Stat, fmtBytes, fmtTime } from '../components/ui';
import { api, type ArchiveResult, type CwAlarm, type CwSeries, type CwStatus, type S3Object } from '../realApi';
import type { Backend } from '../useBackend';

const useAsync = () => {
  const [s, set] = useState<{ busy: boolean; err?: string }>({ busy: false });
  return [s, async <T,>(fn: () => Promise<T>): Promise<T | undefined> => { set({ busy: true }); try { const r = await fn(); set({ busy: false }); return r; } catch (e) { set({ busy: false, err: (e as Error).message }); return undefined; } }] as const;
};

export function CloudPage({ b }: { b: Backend }) {
  const ok = b.health.ok; const cfg = b.cfg;
  const [minutes, setMinutes] = useState(60);
  const [arch, setArch] = useState<ArchiveResult | null>(null);
  const [objs, setObjs] = useState<S3Object[] | null>(null);
  const [cw, setCw] = useState<CwStatus | null>(null);
  const [series, setSeries] = useState<CwSeries | null>(null);
  const [alarms, setAlarms] = useState<CwAlarm[] | null>(null);
  const [aS, runArch] = useAsync(); const [oS, runObjs] = useAsync(); const [pS, runPub] = useAsync(); const [mS, runMetrics] = useAsync(); const [alS, runAlarm] = useAsync();
  const [pubMsg, setPubMsg] = useState<string | null>(null);

  const loadObjs = useCallback(() => runObjs(async () => setObjs((await api.s3Objects()).objects)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const loadCwStatus = useCallback(async () => { try { setCw(await api.cwStatus()); } catch { /* backend offline */ } }, []);
  const loadSeries = useCallback(() => runMetrics(async () => setSeries(await api.cwMetrics(30))), []); // eslint-disable-line react-hooks/exhaustive-deps
  const loadAlarms = useCallback(() => runAlarm(async () => setAlarms((await api.cwAlarms()).alarms)), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (ok) { loadCwStatus(); const id = setInterval(loadCwStatus, 10000); return () => clearInterval(id); } }, [ok, loadCwStatus]);
  useEffect(() => { if (ok && cfg?.s3Configured) loadObjs(); }, [ok, cfg?.s3Configured]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ok && cw?.enabled) { loadSeries(); loadAlarms(); } }, [ok, cw?.enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const archive = async () => { const r = await runArch(() => api.archive(minutes)); if (r) { setArch(r); loadObjs(); } };
  const publish = async () => {
    setPubMsg(null); const r = await runPub(() => api.cwPublish());
    if (r) { setPubMsg(r.skipped ? 'Nothing new to publish.' : `Published ${r.published} metrics to CloudWatch.`); loadCwStatus(); }
  };
  const region = cw?.region ?? cfg?.awsRegion ?? 'us-east-1';
  const toRows = (names: string[]) => { // merge CloudWatch series by timestamp
    const m = new Map<number, Record<string, number> & { t: number }>();
    for (const n of names) for (const p of series?.series[n] ?? []) { const row = m.get(p.t) ?? ({ t: p.t } as Record<string, number> & { t: number }); row[n] = p.v; m.set(p.t, row); }
    return [...m.values()].sort((x, y) => x.t - y.t);
  };
  const rowsReq = toRows(['Requests', 'FailedRequests']); const rowsLat = toRows(['AvgLatencyMs', 'P95LatencyMs']); const rowsErr = toRows(['ErrorRatePercent']);

  return (
    <div className="space-y-4">
      <PageHeader title="AWS Cloud" sub="Cold-storage archive in Amazon S3 and operational monitoring in Amazon CloudWatch." />

      <Panel title="Amazon S3 - telemetry archive" sub="Spans are read back from OpenSearch, compressed (gzip NDJSON), uploaded to S3 and verified with a checksum."
        right={<div className="flex items-center gap-2"><Badge tone={cfg?.s3Configured ? 'green' : 'amber'}>{cfg?.s3Configured ? 'connected' : 'not configured'}</Badge>
          <select className="input !w-auto" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}><option value={15}>last 15 min</option><option value={60}>last 60 min</option><option value={1440}>last 24 h</option></select>
          <button className="btn btn-primary" disabled={!ok || aS.busy || !cfg?.s3Configured} onClick={archive}><Archive size={14} />{aS.busy ? 'Archiving…' : 'Archive to S3'}</button></div>}>
        {!cfg?.s3Configured ? <Note>No S3 bucket is configured on the backend. Set <code>S3_BUCKET</code> and <code>AWS_REGION</code> in <code>.env</code>, then restart (see docs/AWS_SETUP.md).</Note> : (
          <p className="text-xs text-slate-600"><Cloud size={12} className="mr-1 inline" />Bucket <b>{cfg.s3Bucket}</b> · prefix <code>{cfg.s3Prefix}</code> · region {cfg.s3Region ?? region}</p>)}
        {aS.err && <div className="mt-2"><ErrorBox>Archive failed: {aS.err}</ErrorBox></div>}
        {arch && (arch.status === 'empty' ? <div className="mt-2"><Note>{arch.message}</Note></div> : (
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Result" value={<Badge tone={arch.verified ? 'green' : 'red'}>{arch.verified ? 'verified' : arch.status}</Badge>} />
            <Stat label="Spans / traces" value={`${arch.spanCount} / ${arch.traceCount}`} />
            <Stat label="Uploaded" value={fmtBytes(arch.bytesUploaded ?? 0)} sub={`raw ${fmtBytes(arch.bytesUncompressed ?? 0)}`} />
            <Stat label="Storage class" value={arch.storageClass} />
          </div>))}
        {cfg?.s3Configured && (
          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between text-xs font-semibold text-slate-700">Archived objects in the bucket<button className="btn btn-ghost btn-sm" onClick={loadObjs} disabled={oS.busy}><RefreshCw size={12} />Refresh</button></div>
            {oS.err ? <ErrorBox>Could not list the bucket: {oS.err}</ErrorBox> : !objs?.length ? <Empty>No archives yet. Generate traffic, wait ~30 s for indexing, then press <b>Archive to S3</b>.</Empty> : (
              <div className="max-h-60 overflow-auto"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-white text-slate-500"><tr><th className="py-1">Object key</th><th>Size</th><th>Uploaded</th></tr></thead><tbody>
                {[...objs].sort((a, z) => +new Date(z.lastModified) - +new Date(a.lastModified)).map((o) => <tr key={o.key} className="border-t border-slate-100"><td className="break-all py-1 font-mono text-[11px]">{o.key}</td><td className="whitespace-nowrap">{fmtBytes(o.size)}</td><td className="whitespace-nowrap">{new Date(o.lastModified).toLocaleString()}</td></tr>)}
              </tbody></table></div>)}
          </div>)}
      </Panel>

      <Panel title="Amazon CloudWatch - monitoring" sub={`Custom metrics in namespace ${cw?.namespace ?? 'TraceFlow/Telemetry'}, published automatically every ${cw?.intervalSec ?? 60} s while traffic flows.`}
        right={<div className="flex items-center gap-2"><Badge tone={cw?.enabled ? 'green' : 'amber'}>{cw?.enabled ? 'connected' : 'not enabled'}</Badge>
          <a className="btn btn-ghost btn-sm" target="_blank" rel="noreferrer" href={`https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#metricsV2:`}><ExternalLink size={12} />AWS console</a>
          <button className="btn btn-primary" disabled={!ok || !cw?.enabled || pS.busy} onClick={publish}><Send size={14} />{pS.busy ? 'Publishing…' : 'Publish now'}</button></div>}>
        {!cw?.enabled ? <Note>CloudWatch is off. Set <code>CLOUDWATCH_ENABLED=true</code> (and AWS credentials/region) in <code>.env</code>, then restart the backend (see docs/AWS_SETUP.md).</Note> : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Publishes since start" value={cw.publishedBatches} />
              <Stat label="Last publish" value={cw.lastPublishAt ? fmtTime(cw.lastPublishAt) : '-'} />
              <Stat label="Region" value={cw.region ?? '-'} sub={`environment: ${cw.environment}`} />
              <Stat label="Last error" value={cw.lastError ? 'yes' : 'none'} tone={cw.lastError ? 'red' : 'green'} />
            </div>
            {cw.lastError && <div className="mt-2"><ErrorBox>{cw.lastError}{/credential/i.test(cw.lastError) && ' - the backend has no AWS credentials. See docs/AWS_SETUP.md, step 5.'}</ErrorBox></div>}
            {(pubMsg || pS.err) && <div className="mt-2">{pS.err ? <ErrorBox>{pS.err}</ErrorBox> : <Note>{pubMsg}</Note>}</div>}
            <div className="mt-4 flex items-center justify-between text-xs font-semibold text-slate-700">Data read back from CloudWatch (last 30 min)<button className="btn btn-ghost btn-sm" onClick={loadSeries} disabled={mS.busy}><RefreshCw size={12} />Refresh</button></div>
            {mS.err ? <div className="mt-1"><ErrorBox>Could not read CloudWatch: {mS.err}</ErrorBox></div> : (
              <div className="mt-2 grid gap-3 lg:grid-cols-3">
                <ChartCard title="Requests" sub="per minute" empty={!rowsReq.length}><TimeChart data={rowsReq} series={[{ key: 'Requests', name: 'requests', color: COLORS.blue }, { key: 'FailedRequests', name: 'failed', color: COLORS.red }]} /></ChartCard>
                <ChartCard title="Latency" sub="ms" empty={!rowsLat.length}><TimeChart data={rowsLat} series={[{ key: 'AvgLatencyMs', name: 'average', color: COLORS.violet }, { key: 'P95LatencyMs', name: 'p95', color: COLORS.amber }]} /></ChartCard>
                <ChartCard title="Error rate" sub="%" empty={!rowsErr.length}><TimeChart area unit="%" data={rowsErr} series={[{ key: 'ErrorRatePercent', name: 'error %', color: COLORS.red }]} /></ChartCard>
              </div>)}
            <p className="mt-1 text-[11px] text-slate-500">New data points take 1-2 minutes to appear in CloudWatch.</p>

            <div className="mt-4 rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><div className="text-xs"><div className="font-semibold text-slate-800">Alarm: high error rate</div><div className="text-slate-500">Raises an alarm when the average error rate in a minute is above the threshold.</div></div>
                <button className="btn btn-ghost" disabled={alS.busy} onClick={async () => { await runAlarm(async () => { await api.cwCreateAlarm(); setAlarms((await api.cwAlarms()).alarms); }); }}><BellRing size={14} />{alarms?.length ? 'Update alarm' : 'Create alarm'}</button></div>
              {alS.err && <div className="mt-2"><ErrorBox>{alS.err}</ErrorBox></div>}
              {alarms?.map((a) => <div key={a.name} className="mt-2 flex items-center justify-between text-xs"><span className="font-mono">{a.name}</span><span><Badge tone={a.state === 'OK' ? 'green' : a.state === 'ALARM' ? 'red' : 'amber'}>{a.state}</Badge> <span className="text-slate-500">threshold {a.threshold}%</span></span></div>)}
            </div>
          </>)}
      </Panel>
    </div>
  );
}
