// Rolling time series for the dashboard graphs. Every `intervalMs` one point is stored: what happened in that window
// (requests, failures, latency) plus a snapshot of the pipeline counters (supplied by `probe`).
const p95 = (arr) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.ceil(0.95 * s.length) - 1]; };
const fresh = () => ({ ok: 0, failed: 0, durations: [] });

export function createHistory({ intervalMs = 5000, maxPoints = 720, probe = async () => ({}) } = {}) {
  let win = fresh(); const points = []; let last = Date.now(); let timer; let sampling = false;

  async function sample() {
    if (sampling) return; sampling = true;
    try {
      const now = Date.now(); const secs = Math.max((now - last) / 1000, 0.001); last = now;
      const w = win; win = fresh();
      const n = w.ok + w.failed;
      const extra = await probe().catch(() => ({}));
      points.push({
        t: now, requests: n, ok: w.ok, failed: w.failed, rps: +(n / secs).toFixed(2),
        errorRate: n ? +((100 * w.failed) / n).toFixed(1) : 0,
        avgLatencyMs: n ? Math.round(w.durations.reduce((a, b) => a + b, 0) / n) : 0, p95LatencyMs: p95(w.durations), ...extra,
      });
      while (points.length > maxPoints) points.shift();
    } finally { sampling = false; }
  }

  return {
    record({ ok, durationMs }) { if (ok) win.ok += 1; else win.failed += 1; win.durations.push(durationMs); },
    sample,
    series(minutes = 15) { const from = Date.now() - minutes * 60000; return points.filter((p) => p.t >= from); },
    start() { if (intervalMs > 0 && !timer) { timer = setInterval(() => { sample().catch(() => {}); }, intervalMs); timer.unref?.(); } },
    stop() { if (timer) clearInterval(timer); timer = undefined; },
  };
}
