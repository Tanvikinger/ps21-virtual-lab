
import { useCallback, useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { ChartCard, COLORS, TimeChart } from '../components/Charts';
import { Dot, Empty, PageHeader, Stat, fmtMs } from '../components/ui';
import { api, type HistoryPoint, type PipelineMetrics } from '../realApi';
import type { Backend } from '../useBackend';

const RANGES = [
  { m: 5, label: '5 min' },
  { m: 15, label: '15 min' },
  { m: 60, label: '1 hour' },
];

export function DashboardPage({ b }: { b: Backend }) {
  const [minutes, setMinutes] = useState(15);
  const [pts, setPts] = useState<HistoryPoint[]>([]);
  const [m, setM] = useState<PipelineMetrics | null>(null);

  const ok = b.health.ok;

  const load = useCallback(async () => {
    try {
      const [h, p] = await Promise.all([
        api.history(minutes),
        api.metrics(),
      ]);
      setPts(h.points);
      setM(p);
    } catch {
      // Connection status is shown separately.
    }
  }, [minutes]);

  useEffect(() => {
    if (!ok) return;

    load();
    const id = setInterval(load, 5000);

    return () => clearInterval(id);
  }, [ok, load]);

  const req = m?.requests;
  const total = req?.requests ?? 0;
  const failed = req?.failed ?? 0;

  const traffic = pts.filter((p) => p.requests > 0);

  const requestCount = traffic.reduce(
    (sum, p) => sum + p.requests,
    0
  );

  const avg = requestCount
    ? traffic.reduce(
        (sum, p) => sum + p.avgLatencyMs * p.requests,
        0
      ) / requestCount
    : 0;

  const p95 = traffic.length
    ? Math.max(...traffic.map((p) => p.p95LatencyMs))
    : 0;

  const svc = b.health.data?.services;

  return (
    <div className="space-y-6">

      <PageHeader
        title="Dashboard"
        sub="Monitor application performance, traffic and service health."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-slate-200 bg-white p-1 text-xs shadow-sm">
              {RANGES.map((r) => (
                <button
                  key={r.m}
                  onClick={() => setMinutes(r.m)}
                  className={`rounded-md px-3 py-1.5 font-medium transition ${
                    minutes === r.m
                      ? 'bg-sky-600 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            {b.cfg && (
              <a
                className="btn btn-ghost btn-sm"
                href={b.cfg.dashboardsUrl}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={13} />
                OpenSearch Dashboards
              </a>
            )}
          </div>
        }
      />

      {!ok ? (
        <Empty>
          The dashboard fills in as soon as the backend is reachable.
          Start it with <code>docker compose up -d --build</code>.
        </Empty>
      ) : (
        <>
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-800">
                Overview
              </h2>
              <span className="text-xs text-slate-500">
                Live statistics
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <Stat
                label="Requests served"
                value={total}
                sub={`${req?.runs ?? 0} traffic runs`}
              />

              <Stat
                label="Success rate"
                value={
                  total
                    ? `${(((total - failed) / total) * 100).toFixed(1)}%`
                    : '-'
                }
                tone={total && failed / total > 0.2 ? 'red' : 'green'}
                sub={`${failed} failed`}
              />

              <Stat
                label={`Avg latency (${minutes} min)`}
                value={traffic.length ? fmtMs(avg) : '-'}
              />

              <Stat
                label="p95 latency"
                value={traffic.length ? fmtMs(p95) : '-'}
              />

              <Stat
                label="Spans exported"
                value={m?.sdk.exportedSpans ?? 0}
                sub={
                  m?.sdk.failedSpans
                    ? `${m.sdk.failedSpans} failed`
                    : 'no export failures'
                }
                tone={m?.sdk.failedSpans ? 'red' : undefined}
              />

              <Stat
                label="Indexed spans"
                value={m?.opensearch?.indexedSpans ?? '-'}
                sub={
                  m?.opensearch?.reachable
                    ? `Cluster ${m.opensearch.clusterStatus}`
                    : 'Not reachable'
                }
              />
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-800">
                Performance analytics
              </h2>
              <span className="text-xs text-slate-500">
                Updated every 5 seconds
              </span>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard
                title="Throughput"
                sub="Requests per second"
                empty={!traffic.length}
              >
                <TimeChart
                  area
                  data={pts}
                  series={[
                    {
                      key: 'rps',
                      name: 'Requests/sec',
                      color: COLORS.blue,
                    },
                  ]}
                />
              </ChartCard>

              <ChartCard
                title="Latency"
                sub="Average and p95 response time (ms)"
                empty={!traffic.length}
              >
                <TimeChart
                  data={pts.map((p) => ({
                    ...p,
                    avgLatencyMs: p.requests ? p.avgLatencyMs : null,
                    p95LatencyMs: p.requests ? p.p95LatencyMs : null,
                  }))}
                  series={[
                    {
                      key: 'avgLatencyMs',
                      name: 'Average',
                      color: COLORS.violet,
                    },
                    {
                      key: 'p95LatencyMs',
                      name: 'p95',
                      color: COLORS.amber,
                    },
                  ]}
                />
              </ChartCard>

              <ChartCard
                title="Error rate"
                sub="Percentage of failed requests"
                empty={!traffic.length}
              >
                <TimeChart
                  area
                  unit="%"
                  data={pts.map((p) => ({
                    ...p,
                    errorRate: p.requests ? p.errorRate : null,
                  }))}
                  series={[
                    {
                      key: 'errorRate',
                      name: 'Error rate',
                      color: COLORS.red,
                    },
                  ]}
                />
              </ChartCard>

              <ChartCard
                title="Service health"
                sub="Current status of the three application services"
              >
                <div className="flex h-full flex-col justify-center gap-3">
                  {(['A', 'B', 'C'] as const).map((s) => (
                    <div
                      key={s}
                      className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 text-sm"
                    >
                      <span className="flex items-center gap-2 font-medium text-slate-700">
                        <Dot
                          tone={svc?.[s] === 'up' ? 'green' : 'red'}
                        />
                        Service {s}
                      </span>

                      <span
                        className={
                          svc?.[s] === 'up'
                            ? 'font-medium text-emerald-700'
                            : 'font-semibold text-rose-700'
                        }
                      >
                        {svc?.[s] === 'up' ? 'Running' : 'DOWN'}
                      </span>
                    </div>
                  ))}
                </div>
              </ChartCard>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
