import type { ArchiveObject, BatchInfo, Config, Fault, FaultKind, FaultSpec, SeriesPoint, ServiceId, SimEvent, SpanRec, Trace } from './types';
import { hex8, mix, rngFor } from './rng';

interface Sched { t: number; seq: number; fn: () => void }
interface Rec { trace: Trace; enq: number }
interface Batch { id: number; recs: Rec[]; attempt: number }

export const ORDER: ServiceId[] = ['A', 'B', 'C'];
export const FAULT_LABELS: Record<FaultKind, string> = {
  service_down: 'Service unavailable', service_latency: 'Increased service latency', service_errors: 'Elevated service error probability',
  collector_slow: 'Collector slowdown', queue_saturation: 'Queue saturation', exporter_down: 'Exporter unavailable',
  index_down: 'Searchable storage (OpenSearch) unavailable', cold_down: 'Cold object storage unavailable',
};
export const describeFault = (f: FaultSpec) => FAULT_LABELS[f.kind] + (f.target ? ` (Service ${f.target})` : '');

/**
 * Deterministic discrete-event simulator of the telemetry pipeline (virtual clock, milliseconds).
 * Nothing here touches the DOM or real time: advance(toMs) processes scheduled events in order.
 */
export class Simulator {
  cfg: Config;
  now = 0;
  events: SimEvent[] = [];
  traces: Trace[] = [];
  faults: Fault[] = [];
  series: SeriesPoint[] = [];
  batches: BatchInfo[] = [];
  objects: ArchiveObject[] = [];
  generated = 0; inflight = 0; finished = 0; lastFinish = 0;
  waiting: Trace[] = [];
  collectorWaiting = 0; collectorBusyUntil = 0; pendingSampling = 0;
  buf: Rec[] = []; held = 0; maxQueue = 0; exporterBusy = false; ready: Batch[] = [];
  exportAttemptFailures = 0; exportRetries = 0; archiveFailures = 0;
  indexPendingNow = 0; maxIndexPending = 0; archPendingNow = 0; maxArchPending = 0;
  private q: Sched[] = []; private seq = 0; private timerToken = 0; private batchId = 0; private faultId = 0;
  private win: { dur: number; err: boolean }[] = [];
  private indexLogged = false; private coldLogged = false;

  constructor(cfg: Config) {
    this.cfg = JSON.parse(JSON.stringify(cfg));
    for (const f of this.cfg.faults) this.addFault(f);
    this.at(0, () => this.arrive(0));
    this.at(250, () => this.sample());
    this.at(this.cfg.storage.archiveIntervalMs, () => this.archiveTick());
  }

  // ---------- scheduler ----------
  private at(t: number, fn: () => void) {
    const e: Sched = { t: Math.max(t, this.now), seq: this.seq++, fn };
    let lo = 0, hi = this.q.length;
    while (lo < hi) { const m = (lo + hi) >> 1; const x = this.q[m]; if (x.t < e.t || (x.t === e.t && x.seq < e.seq)) lo = m + 1; else hi = m; }
    this.q.splice(lo, 0, e);
  }
  advance(to: number) {
    while (this.q.length && this.q[0].t <= to) { const e = this.q.shift()!; this.now = e.t; e.fn(); }
    this.now = Math.max(this.now, to);
  }
  runToEnd(stepMs = 100) { while (!this.isDone()) this.advance(this.now + stepMs); return this; }
  log(level: SimEvent['level'], type: string, msg: string) {
    this.events.push({ t: Math.round(this.now), level, type, msg });
    if (this.events.length > 5000) this.events.splice(0, 1000);
  }

  // ---------- faults ----------
  addFault(spec: FaultSpec): number {
    const f: Fault = { ...spec, id: ++this.faultId };
    this.faults.push(f);
    this.at(f.startMs, () => this.log('warn', 'fault', `Fault injected: ${describeFault(f)}`));
    const end = f.endMs;
    if (end != null) this.at(end, () => { if (f.endMs === end) this.log('info', 'recovery', `Fault removed: ${describeFault(f)}`); });
    return f.id;
  }
  removeFault(id: number) {
    const f = this.faults.find((x) => x.id === id);
    if (f && (f.endMs == null || f.endMs > this.now)) { f.endMs = this.now; this.log('info', 'recovery', `Fault removed: ${describeFault(f)}`); }
  }
  active(kind: FaultKind, t: number, target?: ServiceId): Fault | undefined {
    return this.faults.find((f) => f.kind === kind && (!target || f.target === target) && f.startMs <= t && (f.endMs == null || t < f.endMs));
  }
  svcDown = (s: ServiceId, t: number) => !this.cfg.services[s].available || !!this.active('service_down', t, s);
  exporterDown = (t: number) => !this.cfg.storage.exporterAvailable || !!this.active('exporter_down', t);
  indexDown = (t: number) => !this.cfg.storage.indexAvailable || !!this.active('index_down', t);
  coldDown = (t: number) => !this.cfg.storage.coldAvailable || !!this.active('cold_down', t);

  // ---------- application request path ----------
  private arrive(i: number) {
    const c = this.cfg.traffic;
    if (i >= c.totalRequests) return;
    const id = [11, 12, 13, 14].map((s) => hex8(mix(c.seed, i, s))).join('');
    const tr: Trace = {
      id, idx: i, startMs: this.now, endMs: null, durationMs: null, status: 'processing', slow: false, spans: [], services: [],
      sampling: { state: 'none', reason: 'Request still in progress' }, export: 'none', index: 'none', archive: 'none',
    };
    this.traces.push(tr);
    this.generated++;
    if (this.inflight < c.concurrency) this.startReq(tr); else this.waiting.push(tr);
    this.at(this.now + 1000 / c.arrivalRate, () => this.arrive(i + 1));
  }

  private startReq(tr: Trace) {
    this.inflight++;
    const c = this.cfg, r = rngFor(c.traffic.seed, tr.idx, 1);
    const slowReq = r() < c.traffic.slowProb;
    const slowSvc = Math.floor(r() * 3);
    const dr = ORDER.map(() => ({ j: 0.8 + 0.4 * r(), e: r() }));
    let t = this.now, failAt = -1, msg = '';
    const st = [0, 0, 0], en = [0, 0, 0], post = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const s = ORDER[k];
      st[k] = t;
      if (this.svcDown(s, t)) { en[k] = t + 2; failAt = k; msg = `Service ${s} unavailable (connection refused)`; break; }
      let w = c.traffic.baseLatencyMs * c.services[s].latencyFactor * dr[k].j;
      const lf = this.active('service_latency', t, s);
      if (lf) w *= lf.magnitude ?? 5;
      if (slowReq && slowSvc === k) w *= c.traffic.slowMultiplier;
      let p = Math.min(1, c.traffic.errorProb + c.services[s].errorProb);
      const ef = this.active('service_errors', t, s);
      if (ef) p = Math.min(1, p + (ef.magnitude ?? 0.5));
      if (dr[k].e < p) { en[k] = t + w / 2; failAt = k; msg = `Service ${s} returned HTTP 500 (internal error)`; break; }
      if (k === 2) en[k] = t + w; else { post[k] = w / 2; t += w / 2; }
    }
    const last = failAt >= 0 ? failAt : 2;
    for (let k = last - 1; k >= 0; k--) en[k] = en[k + 1] + post[k];
    const spans: SpanRec[] = [];
    for (let k = 0; k <= last; k++) {
      const s = ORDER[k];
      const sp: SpanRec = { id: `${tr.id.slice(0, 8)}-${s}`, traceId: tr.id, parentId: k === 0 ? null : spans[k - 1].id, service: s, name: `${s}.handleRequest`, startMs: st[k], endMs: en[k], status: failAt >= 0 ? 'error' : 'ok' };
      if (failAt >= 0 && k < failAt) sp.error = `Downstream Service ${ORDER[k + 1]} failed`;
      if (k === failAt) { sp.error = msg; sp.origin = true; }
      spans.push(sp);
    }
    tr.spans = spans; tr.services = spans.map((s) => s.service); tr.endMs = en[0];
    this.at(en[0], () => this.finish(tr, failAt >= 0, msg));
  }

  private finish(tr: Trace, failed: boolean, msg: string) {
    tr.status = failed ? 'error' : 'success';
    tr.durationMs = tr.endMs! - tr.startMs;
    tr.slow = tr.durationMs >= this.cfg.sampling.slowThresholdMs;
    this.inflight--; this.finished++; this.lastFinish = this.now;
    this.win.push({ dur: tr.durationMs, err: failed });
    if (failed) this.log('warn', 'request', `Trace ${tr.id.slice(0, 8)} failed: ${msg}`);
    const nxt = this.waiting.shift();
    if (nxt) this.startReq(nxt);
    // Spans are exported by the (simulated) instrumentation to the collector a few ms later.
    this.at(this.now + 2, () => this.toCollector(tr));
  }

  // ---------- telemetry pipeline ----------
  private toCollector(tr: Trace) {
    if (this.collectorWaiting >= this.cfg.collector.backlogLimit) {
      tr.sampling = { state: 'lost', reason: 'Lost: collector backlog full, telemetry rejected before sampling' };
      this.log('error', 'collector', `Collector backlog full: telemetry for ${tr.id.slice(0, 8)} lost`);
      return;
    }
    const slow = this.active('collector_slow', this.now);
    const per = this.cfg.collector.msPerTrace * (slow ? slow.magnitude ?? 40 : 1);
    const start = Math.max(this.now, this.collectorBusyUntil);
    const wait = start - this.now;
    this.collectorBusyUntil = start + per;
    this.collectorWaiting++;
    tr.sampling = { state: 'pending', reason: 'Pending: waiting in collector queue' };
    this.at(this.collectorBusyUntil, () => { this.collectorWaiting--; this.enterSampling(tr, wait); });
  }

  private enterSampling(tr: Trace, queueWait: number) {
    const s = this.cfg.sampling;
    if (queueWait > s.waitMs) {
      tr.sampling = { state: 'incomplete', reason: `Incomplete: spans waited ${Math.round(queueWait)} ms in the collector, longer than the ${s.waitMs} ms decision window` };
      return;
    }
    if (this.pendingSampling >= s.maxPending) {
      tr.sampling = { state: 'lost', reason: 'Lost: tail-sampling pending-trace buffer was full' };
      this.log('error', 'sampling', `Pending-trace buffer full: ${tr.id.slice(0, 8)} lost`);
      return;
    }
    this.pendingSampling++;
    tr.sampling = { state: 'pending', reason: 'Pending: waiting for trace information' };
    this.at(this.now + s.waitMs, () => this.decide(tr));
  }

  private decide(tr: Trace) {
    this.pendingSampling--;
    const s = this.cfg.sampling;
    if (tr.status === 'error' && s.retainErrors) this.retain(tr, 'error', 'Retained: Error');
    else if (tr.slow && s.retainSlow) this.retain(tr, 'slow', `Retained: Slow (${Math.round(tr.durationMs!)} ms >= ${s.slowThresholdMs} ms)`);
    else if (rngFor(this.cfg.traffic.seed, tr.idx, 2)() * 100 < s.ordinaryPct) this.retain(tr, 'ordinary', 'Retained: Ordinary sampling policy');
    else tr.sampling = { state: 'dropped', code: 'ordinary', reason: 'Dropped: Ordinary sampling policy' };
  }

  private retain(tr: Trace, code: 'error' | 'slow' | 'ordinary', reason: string) {
    tr.sampling = { state: 'retained', code, reason };
    const cap = this.active('queue_saturation', this.now)?.magnitude ?? (this.active('queue_saturation', this.now) ? 5 : this.cfg.batch.queueCapacity);
    if (this.buf.length + this.held >= cap) {
      tr.export = 'dropped'; tr.exportNote = 'Dropped: exporter queue was full';
      this.log('error', 'queue', `Queue full (${cap}): ${tr.id.slice(0, 8)} dropped`);
      return;
    }
    tr.export = 'queued'; tr.enqueuedAt = this.now;
    this.buf.push({ trace: tr, enq: this.now });
    this.maxQueue = Math.max(this.maxQueue, this.buf.length + this.held);
    if (this.buf.length >= this.cfg.batch.size) this.flush('size');
    else if (this.buf.length === 1) {
      const token = this.timerToken;
      this.at(this.now + this.cfg.batch.timeoutMs, () => { if (token === this.timerToken && this.buf.length > 0) this.flush('timeout'); });
    }
  }

  private flush(reason: 'size' | 'timeout') {
    const recs = this.buf.splice(0, this.buf.length);
    this.timerToken++;
    this.held += recs.length;
    const b: Batch = { id: ++this.batchId, recs, attempt: 0 };
    this.batches.push({ id: b.id, size: recs.length, reason, at: this.now });
    this.ready.push(b);
    this.pump();
  }

  private pump() {
    if (this.exporterBusy || !this.ready.length) return;
    const b = this.ready.shift()!;
    this.exporterBusy = true;
    const d = this.cfg.batch.exportDelayMs + this.cfg.batch.perRecordMs * b.recs.length;
    this.at(this.now + d, () => { this.exporterBusy = false; this.finishExport(b); this.pump(); });
  }

  private finishExport(b: Batch) {
    if (this.exporterDown(this.now)) {
      b.attempt++; this.exportAttemptFailures++;
      if (b.attempt <= this.cfg.batch.maxRetries) {
        this.exportRetries++;
        const back = 200 * 2 ** (b.attempt - 1);
        this.log('warn', 'export', `Batch #${b.id} export failed (exporter unavailable); retry ${b.attempt}/${this.cfg.batch.maxRetries} in ${back} ms`);
        this.at(this.now + back, () => { this.ready.unshift(b); this.pump(); });
      } else {
        for (const r of b.recs) { r.trace.export = 'failed'; r.trace.exportNote = `Export failed after ${this.cfg.batch.maxRetries} retries (exporter unavailable)`; }
        this.held -= b.recs.length;
        this.log('error', 'export', `Batch #${b.id} abandoned: ${b.recs.length} traces lost`);
      }
      return;
    }
    this.held -= b.recs.length;
    for (const r of b.recs) {
      const tr = r.trace;
      tr.export = 'exported'; tr.exportedAt = this.now; tr.index = 'pending'; tr.archive = 'pending';
      this.indexPendingNow++; this.maxIndexPending = Math.max(this.maxIndexPending, this.indexPendingNow);
      this.archPendingNow++; this.maxArchPending = Math.max(this.maxArchPending, this.archPendingNow);
      this.at(this.now + this.cfg.storage.indexDelayMs, () => this.tryIndex(tr, 1));
    }
    this.log('info', 'export', `Batch #${b.id} exported (${b.recs.length} traces)`);
  }

  // ---------- searchable storage (OpenSearch) ----------
  private tryIndex(tr: Trace, attempt: number) {
    if (this.indexDown(this.now)) {
      if (attempt < 12) {
        if (!this.indexLogged) { this.indexLogged = true; this.log('warn', 'index', 'Indexing failed: searchable storage unavailable; records stay Pending and are retried'); }
        this.at(this.now + Math.min(1000, 200 * attempt), () => this.tryIndex(tr, attempt + 1));
      } else { tr.index = 'failed'; this.indexPendingNow--; this.log('error', 'index', `Indexing of ${tr.id.slice(0, 8)} abandoned after ${attempt} attempts`); }
      return;
    }
    if (this.indexLogged) { this.indexLogged = false; this.log('info', 'index', 'Searchable storage reachable again: pending records are being indexed'); }
    tr.index = 'indexed'; tr.indexedAt = this.now; this.indexPendingNow--;
  }

  // ---------- cold archival ----------
  private archiveTick() {
    this.at(this.now + this.cfg.storage.archiveIntervalMs, () => this.archiveTick());
    const el = this.traces.filter((t) => t.archive === 'pending' && t.exportedAt != null && this.now - t.exportedAt >= this.cfg.storage.archiveAfterMs).slice(0, 100);
    if (!el.length) return;
    if (this.coldDown(this.now)) {
      this.archiveFailures++;
      if (!this.coldLogged) { this.coldLogged = true; this.log('error', 'archive', `Archive write failed: cold storage unavailable (${el.length} traces waiting)`); }
      return;
    }
    if (this.coldLogged) { this.coldLogged = false; this.log('info', 'archive', 'Cold storage reachable again: archiving waiting traces'); }
    const obj: ArchiveObject = { id: `obj-${String(this.objects.length + 1).padStart(4, '0')}`, at: this.now, count: el.length, traceIds: el.map((t) => t.id) };
    this.objects.push(obj);
    for (const t of el) { t.archive = 'archived'; t.archivedAt = this.now; }
    this.archPendingNow -= el.length;
    this.log('info', 'archive', `Created ${obj.id} with ${el.length} traces`);
  }

  // ---------- metrics sampling & completion ----------
  private sample() {
    const w = this.win; this.win = [];
    const n = w.length;
    this.series.push({
      t: this.now, throughput: n / 0.25, avgLatency: n ? w.reduce((a, x) => a + x.dur, 0) / n : 0,
      errorRate: n ? (w.filter((x) => x.err).length / n) * 100 : 0, queueDepth: this.buf.length + this.held, collectorBacklog: this.collectorWaiting,
    });
    this.at(this.now + 250, () => this.sample());
  }

  isDone(): boolean {
    const c = this.cfg;
    if (this.now > c.traffic.totalRequests / c.traffic.arrivalRate * 1000 + 120000) return true;
    if (this.generated < c.traffic.totalRequests || this.inflight > 0 || this.waiting.length) return false;
    if (this.collectorWaiting || this.pendingSampling || this.buf.length || this.held) return false;
    if (this.traces.some((t) => t.index === 'pending')) return false;
    if (this.faults.some((f) => f.endMs != null && f.endMs > this.now)) return false;
    const archPending = this.traces.some((t) => t.archive === 'pending');
    return !archPending || this.now > this.lastFinish + 20000;
  }
}
