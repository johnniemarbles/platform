import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Counter,
  Histogram,
  Registry,
  recordGateMetric,
  getMetricsRegistry,
} from '../src/metrics.ts';

test('Counter increments and renders Prometheus text', () => {
  const c = new Counter('test_requests_total', 'Test requests.');
  c.inc({ route: 'a' });
  c.inc({ route: 'a' }, 2);
  const text = c.render();
  assert.match(text, /# TYPE test_requests_total counter/);
  assert.match(text, /test_requests_total\{route="a"\} 3/);
});

test('Histogram observes buckets', () => {
  const h = new Histogram('test_latency_seconds', 'Latency.', [0.1, 0.5, 1]);
  h.observe(0.05, { gate: 'X' });
  h.observe(0.4, { gate: 'X' });
  const text = h.render();
  assert.match(text, /test_latency_seconds_count\{gate="X"\} 2/);
  assert.match(text, /le="0.1"/);
  assert.match(text, /le="\+Inf"/);
});

test('Registry includes process uptime', () => {
  const reg = new Registry();
  reg.register(new Counter('noop_total', 'noop'));
  const text = reg.render();
  assert.match(text, /process_uptime_seconds /);
});

test('recordGateMetric writes verdict and latency', () => {
  // Use process registry; may accumulate across tests — assert increase shape.
  recordGateMetric({ gate: 'QUOTA_THROTTLE', verdict: 'FAIL', elapsedMs: 12 });
  const text = getMetricsRegistry().render();
  assert.match(text, /expadio_gate_verdicts_total/);
  assert.match(text, /gate="QUOTA_THROTTLE"/);
  assert.match(text, /verdict="FAIL"/);
  assert.match(text, /expadio_gate_latency_seconds/);
});
