import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../src/collectorMetrics.js';

test('summarize parses real Collector v0.165 metric text', () => {
  const t = `# HELP x
otelcol_receiver_accepted_spans{receiver="otlp",transport="http"} 1390
otelcol_exporter_sent_spans{exporter="otlp/dataprepper"} 475
otelcol_processor_batch_batch_send_size_sum{processor="batch"} 475
otelcol_processor_batch_batch_send_size_count{processor="batch"} 2
otelcol_processor_batch_timeout_trigger_send{processor="batch"} 2
otelcol_processor_tail_sampling_count_traces_sampled{decision="sampled",policy="keep-error-traces",sampled="true"} 44
otelcol_processor_tail_sampling_count_traces_sampled{decision="not_sampled",policy="keep-error-traces",sampled="false"} 256`;
  const s = summarize(t);
  assert.equal(s.receivedSpans, 1390); assert.equal(s.exportedSpans, 475); assert.equal(s.spansNotExported, 915);
  assert.equal(s.batch.avgBatchSize, 237.5); assert.equal(s.batch.timeoutTriggered, 2);
  assert.equal(s.tailSampling.tracesEvaluated, 300); assert.deepEqual(s.tailSampling.byPolicy['keep-error-traces'], { sampled: 44, notSampled: 256 });
});
